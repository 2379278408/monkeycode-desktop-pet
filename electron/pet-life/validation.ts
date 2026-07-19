export interface PetLifeSnapshot {
  mood: number
  satiety: number
  energy: number
  sleeping: boolean
  lastCalculatedAt: number
  lastInteractionAt: number
}

export const MAX_PET_LIFE_SNAPSHOT_BYTES = 16 * 1024

const SAVE_ERROR_MESSAGE = '桌宠生命状态保存失败'
const SNAPSHOT_KEYS = [
  'energy',
  'lastCalculatedAt',
  'lastInteractionAt',
  'mood',
  'satiety',
  'sleeping',
] as const

export function assertPetLifeSnapshotPayload(value: unknown): PetLifeSnapshot {
  try {
    const serialized = JSON.stringify(value)
    if (typeof serialized !== 'string'
      || new TextEncoder().encode(serialized).byteLength > MAX_PET_LIFE_SNAPSHOT_BYTES) {
      throw new Error()
    }
    const parsed: unknown = JSON.parse(serialized)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()

    const keys = Object.keys(parsed).sort()
    if (keys.length !== SNAPSHOT_KEYS.length
      || keys.some((key, index) => key !== SNAPSHOT_KEYS[index])) {
      throw new Error()
    }

    const source = parsed as Record<string, unknown>
    const snapshot = {
      mood: source.mood,
      satiety: source.satiety,
      energy: source.energy,
      sleeping: source.sleeping,
      lastCalculatedAt: source.lastCalculatedAt,
      lastInteractionAt: source.lastInteractionAt,
    }
    if (typeof snapshot.mood !== 'number' || !Number.isFinite(snapshot.mood)
      || typeof snapshot.satiety !== 'number' || !Number.isFinite(snapshot.satiety)
      || typeof snapshot.energy !== 'number' || !Number.isFinite(snapshot.energy)
      || typeof snapshot.sleeping !== 'boolean'
      || typeof snapshot.lastCalculatedAt !== 'number'
      || typeof snapshot.lastInteractionAt !== 'number') {
      throw new Error()
    }
    return snapshot as PetLifeSnapshot
  } catch {
    throw new Error(SAVE_ERROR_MESSAGE)
  }
}
