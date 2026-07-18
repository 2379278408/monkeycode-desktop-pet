export type PetForm = 'normal' | 'happy' | 'sad' | 'hungry' | 'sleepy' | 'sleeping'

export interface PetLifeSnapshot {
  mood: number
  satiety: number
  energy: number
  sleeping: boolean
  lastCalculatedAt: number
  lastInteractionAt: number
}

export type PetLifeEvent =
  | { type: 'click' }
  | { type: 'double-click' }
  | { type: 'pet'; seconds: number }
  | { type: 'feed' }
  | { type: 'sleep' }
  | { type: 'wake' }
  | { type: 'task-success' }
  | { type: 'task-error' }

const HOUR_MS = 3_600_000
const MAX_SETTLEMENT_MS = 72 * HOUR_MS
const clamp = (value: number) => Math.min(100, Math.max(0, value))

export function settlePetLife(snapshot: PetLifeSnapshot, now: number): PetLifeSnapshot {
  if (!Number.isFinite(now)) return { ...snapshot }

  const effectiveNow = Math.max(snapshot.lastCalculatedAt, now)
  const elapsedMs = Math.min(MAX_SETTLEMENT_MS, effectiveNow - snapshot.lastCalculatedAt)
  const elapsedHours = elapsedMs / HOUR_MS
  const neglectedMs = Math.max(0, effectiveNow - snapshot.lastInteractionAt - 6 * HOUR_MS)
  const neglectedHours = Math.min(elapsedMs, neglectedMs) / HOUR_MS

  return {
    ...snapshot,
    mood: clamp(snapshot.mood - neglectedHours),
    satiety: clamp(snapshot.satiety - (snapshot.sleeping ? 0 : 2 * elapsedHours)),
    energy: clamp(snapshot.energy + (snapshot.sleeping ? 8 : -1.5) * elapsedHours),
    lastCalculatedAt: effectiveNow,
  }
}

export function derivePetForm(snapshot: PetLifeSnapshot, previousForm: PetForm): PetForm {
  if (snapshot.sleeping) return 'sleeping'
  if (snapshot.satiety <= 25 || (previousForm === 'hungry' && snapshot.satiety <= 35)) {
    return 'hungry'
  }
  if (snapshot.energy <= 20 || (previousForm === 'sleepy' && snapshot.energy <= 35)) {
    return 'sleepy'
  }
  if (snapshot.mood <= 30 || (previousForm === 'sad' && snapshot.mood <= 40)) return 'sad'
  if (snapshot.mood >= 70 || (previousForm === 'happy' && snapshot.mood >= 60)) return 'happy'
  return 'normal'
}

export function applyPetEvent(
  snapshot: PetLifeSnapshot,
  event: PetLifeEvent,
  now: number,
): PetLifeSnapshot {
  const settled = settlePetLife(snapshot, now)
  const interactionAt = settled.lastCalculatedAt

  switch (event.type) {
    case 'feed':
      return {
        ...settled,
        satiety: clamp(settled.satiety + 25),
        mood: clamp(settled.mood + 2),
        lastInteractionAt: interactionAt,
      }
    case 'sleep':
      return { ...settled, sleeping: true, lastInteractionAt: interactionAt }
    case 'wake':
      return { ...settled, sleeping: false, lastInteractionAt: interactionAt }
    case 'click':
      return { ...settled, mood: clamp(settled.mood + 1), lastInteractionAt: interactionAt }
    case 'double-click':
      return { ...settled, mood: clamp(settled.mood + 3), lastInteractionAt: interactionAt }
    case 'pet': {
      const moodGain = Number.isFinite(event.seconds) && event.seconds >= 0
        ? Math.min(5, Math.floor(event.seconds / 2))
        : 0
      return {
        ...settled,
        mood: clamp(settled.mood + moodGain),
        lastInteractionAt: interactionAt,
      }
    }
    case 'task-success':
      return { ...settled, mood: clamp(settled.mood + 2) }
    case 'task-error':
      return { ...settled, mood: clamp(settled.mood - 2) }
    default:
      return assertNever(event)
  }
}

function assertNever(event: never): never {
  throw new Error(`Unhandled pet life event: ${JSON.stringify(event)}`)
}
