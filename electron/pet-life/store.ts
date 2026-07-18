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

function isSafeIntegerTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
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
    lastCalculatedAt: Math.max(0, candidate.lastCalculatedAt),
    lastInteractionAt: Math.max(0, candidate.lastInteractionAt),
  }
}

function safeReadError(error: unknown): string {
  if (error instanceof SyntaxError) return 'SyntaxError: JSON 解析失败'
  if (error instanceof Error) return `${error.name}: 文件读取失败`
  return 'UnknownError: 文件读取失败'
}

export class PetLifeStore {
  constructor(private readonly filePath: string) {}

  load(): PetLifeSnapshot | null {
    try {
      if (!fs.existsSync(this.filePath)) return null
      if (fs.statSync(this.filePath).size > MAX_SNAPSHOT_FILE_SIZE) {
        console.warn('[PetLife] 无法读取生命状态', 'FileTooLargeError: 文件过大')
        return null
      }
      return normalizePetLifeSnapshot(JSON.parse(fs.readFileSync(this.filePath, 'utf8')))
    } catch (error) {
      console.warn('[PetLife] 无法读取生命状态', safeReadError(error))
      return null
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
