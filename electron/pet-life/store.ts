import fs from 'node:fs'
import path from 'node:path'
import {
  MAX_PET_LIFE_SNAPSHOT_BYTES,
  assertPetLifeSnapshotPayload,
  type PetLifeSnapshot,
} from './validation'

export type { PetLifeSnapshot } from './validation'

const clampLifeValue = (value: number): number => Math.min(100, Math.max(0, value))
const MAX_FUTURE_OFFSET_MS = 24 * 60 * 60_000
const LOAD_ERROR_MESSAGE = '桌宠生命状态读取失败'

class PetLifeLoadError extends Error {
  constructor() {
    super(LOAD_ERROR_MESSAGE)
    this.name = 'PetLifeLoadError'
  }
}

function isSafeIntegerTimestamp(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return false
  const wallNow = Date.now()
  const safeWallNow = Number.isSafeInteger(wallNow) && wallNow >= 0 ? wallNow : 0
  const latestAllowed = Math.min(Number.MAX_SAFE_INTEGER, safeWallNow + MAX_FUTURE_OFFSET_MS)
  return value <= latestAllowed
}

export function normalizePetLifeSnapshot(value: unknown): PetLifeSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const candidate = value as Partial<PetLifeSnapshot>
  const numbers = [
    candidate.mood,
    candidate.satiety,
    candidate.energy,
    candidate.lastCalculatedAt,
    candidate.lastInteractionAt,
  ]
  if (numbers.some((item) => typeof item !== 'number' || !Number.isFinite(item))
    || typeof candidate.sleeping !== 'boolean') {
    return null
  }
  if (!isSafeIntegerTimestamp(candidate.lastCalculatedAt)
    || !isSafeIntegerTimestamp(candidate.lastInteractionAt)) {
    return null
  }

  return {
    mood: clampLifeValue(candidate.mood!),
    satiety: clampLifeValue(candidate.satiety!),
    energy: clampLifeValue(candidate.energy!),
    sleeping: candidate.sleeping,
    lastCalculatedAt: candidate.lastCalculatedAt,
    lastInteractionAt: candidate.lastInteractionAt,
  }
}

function warnInvalidData(diagnostic: string): null {
  console.warn('[PetLife] 无法读取生命状态', diagnostic)
  return null
}

export class PetLifeStore {
  constructor(private readonly filePath: string) {}

  load(): PetLifeSnapshot | null {
    try {
      if (fs.statSync(this.filePath).size > MAX_PET_LIFE_SNAPSHOT_BYTES) {
        return warnInvalidData('FileTooLargeError: 文件过大')
      }
      const normalized = normalizePetLifeSnapshot(
        JSON.parse(fs.readFileSync(this.filePath, 'utf8')),
      )
      if (!normalized) return warnInvalidData('InvalidSnapshotError: 数据格式无效')
      return normalized
    } catch (error) {
      if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      if (error instanceof SyntaxError) {
        return warnInvalidData('SyntaxError: JSON 解析失败')
      }
      console.warn('[PetLife] 无法读取生命状态', 'Error: 文件读取失败')
      throw new PetLifeLoadError()
    }
  }

  save(snapshot: PetLifeSnapshot): void {
    const payload = assertPetLifeSnapshotPayload(snapshot)
    const normalized = normalizePetLifeSnapshot(payload)
    if (!normalized) throw new Error('桌宠生命状态保存失败')

    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`
    fs.writeFileSync(temporaryPath, JSON.stringify(normalized, null, 2), 'utf8')
    fs.renameSync(temporaryPath, this.filePath)
  }
}
