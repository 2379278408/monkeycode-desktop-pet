import fs from 'node:fs'
import path from 'node:path'

export interface PetLifeSnapshot {
  mood: number
  satiety: number
  energy: number
  sleeping: boolean
  lastCalculatedAt: number
  lastInteractionAt: number
}

const clampLifeValue = (value: number): number => Math.min(100, Math.max(0, value))
const MAX_SNAPSHOT_FILE_SIZE = 16 * 1024
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

function safeReadError(error: unknown): string {
  if (error instanceof SyntaxError) return 'SyntaxError: JSON 解析失败'
  if (error instanceof Error) return `${error.name}: 文件读取失败`
  return 'UnknownError: 文件读取失败'
}

function throwLoadError(diagnostic: string): never {
  console.warn('[PetLife] 无法读取生命状态', diagnostic)
  throw new PetLifeLoadError()
}

export class PetLifeStore {
  constructor(private readonly filePath: string) {}

  load(): PetLifeSnapshot | null {
    try {
      if (fs.statSync(this.filePath).size > MAX_SNAPSHOT_FILE_SIZE) {
        throwLoadError('FileTooLargeError: 文件过大')
      }
      const normalized = normalizePetLifeSnapshot(
        JSON.parse(fs.readFileSync(this.filePath, 'utf8')),
      )
      if (!normalized) throwLoadError('InvalidSnapshotError: 数据格式无效')
      return normalized
    } catch (error) {
      if (error instanceof PetLifeLoadError) throw error
      if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      console.warn('[PetLife] 无法读取生命状态', safeReadError(error))
      throw new PetLifeLoadError()
    }
  }

  save(snapshot: PetLifeSnapshot): void {
    const normalized = normalizePetLifeSnapshot(snapshot)
    if (!normalized) throw new Error('无效桌宠生命状态')

    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`
    fs.writeFileSync(temporaryPath, JSON.stringify(normalized, null, 2), 'utf8')
    fs.renameSync(temporaryPath, this.filePath)
  }
}
