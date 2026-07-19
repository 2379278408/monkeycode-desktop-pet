import { create } from 'zustand'
import {
  applyPetEvent,
  derivePetForm,
  settlePetLife,
  type PetForm,
  type PetLifeEvent,
  type PetLifeSnapshot,
} from '../lib/pet-life'

type PetInteraction =
  | 'click'
  | 'double-click'
  | { type: 'click' }
  | { type: 'double-click' }
  | { type: 'pet'; seconds: number }

type PendingOperation =
  | { type: 'event'; event: PetLifeEvent; now: number }
  | { type: 'tick'; now: number }

export interface PetLifeStoreState {
  snapshot: PetLifeSnapshot
  form: PetForm
  hydrated: boolean
  persistenceError: string | null
  hydrate: (now?: number) => Promise<void>
  interact: (interaction: PetInteraction, now?: number) => void
  feed: (now?: number) => void
  sleep: (now?: number) => void
  wake: (now?: number) => void
  tick: (now?: number) => void
  recordTaskResult: (status: 'finished' | 'error', eventKey: string, now?: number) => void
  reset: () => void
}

const RATE_LIMIT_WINDOW_MS = 10 * 60_000
const CLICK_LIMIT = 3
const DOUBLE_CLICK_LIMIT = 2
const TASK_RESULT_KEY_LIMIT = 256
const TASK_RESULT_KEY_MAX_LENGTH = 512
const MAX_FUTURE_OFFSET_MS = 24 * 60 * 60_000
const PERSISTENCE_ERROR = '生命状态暂时无法保存，请稍后重试'

let clickHistory: number[] = []
let doubleClickHistory: number[] = []
let pendingOperations: PendingOperation[] = []
let handledTaskResultKeys = new Set<string>()
let hydratePromise: Promise<void> | null = null
let saveQueue: Promise<void> = Promise.resolve()
let storeGeneration = 0
let writeAllowed = true

function normalizeOperationTime(now: number): number {
  const fallback = Date.now()
  const wallNow = Number.isFinite(fallback)
    && fallback >= 0
    && fallback <= Number.MAX_SAFE_INTEGER
    ? Math.floor(fallback)
    : 0
  const latestAllowed = Math.min(Number.MAX_SAFE_INTEGER, wallNow + MAX_FUTURE_OFFSET_MS)
  const candidate = Number.isFinite(now)
    && now >= 0
    && now <= latestAllowed
    ? now
    : wallNow
  return Math.floor(candidate)
}

function createInitialSnapshot(now = Date.now()): PetLifeSnapshot {
  const safeNow = normalizeOperationTime(now)
  return {
    mood: 50,
    satiety: 50,
    energy: 50,
    sleeping: false,
    lastCalculatedAt: safeNow,
    lastInteractionAt: safeNow,
  }
}

function electronAPI() {
  if (typeof window === 'undefined' || !window.electronAPI) {
    throw new Error('Pet life persistence is unavailable')
  }
  return window.electronAPI
}

export const usePetLifeStore = create<PetLifeStoreState>((set, get) => {
  function recordPersistenceError(generation: number): void {
    if (generation !== storeGeneration || get().persistenceError !== null) return
    set({ persistenceError: PERSISTENCE_ERROR })
  }

  function clearPersistenceError(generation: number): void {
    if (generation !== storeGeneration || get().persistenceError === null) return
    set({ persistenceError: null })
  }

  function persist(snapshot: PetLifeSnapshot): Promise<void> {
    if (!writeAllowed) return Promise.resolve()

    const savedSnapshot = { ...snapshot }
    const generation = storeGeneration
    let savePetLife: (value: PetLifeSnapshot) => Promise<void>

    try {
      savePetLife = electronAPI().savePetLife
    } catch {
      recordPersistenceError(generation)
      return Promise.resolve()
    }

    const save = saveQueue.then(() => savePetLife(savedSnapshot))
    saveQueue = save.then(
      () => clearPersistenceError(generation),
      () => recordPersistenceError(generation),
    )
    return saveQueue
  }

  function applyOperation(snapshot: PetLifeSnapshot, operation: PendingOperation): PetLifeSnapshot {
    return operation.type === 'event'
      ? applyPetEvent(snapshot, operation.event, operation.now)
      : settlePetLife(snapshot, operation.now)
  }

  function commitOperation(operation: PendingOperation): void {
    const current = get()
    const nextSnapshot = applyOperation(current.snapshot, operation)
    set({
      snapshot: nextSnapshot,
      form: derivePetForm(nextSnapshot, current.form),
    })

    if (!current.hydrated) {
      pendingOperations.push(operation)
      return
    }

    void persist(nextSnapshot)
  }

  function limitedInteractionEvent(
    interaction: PetInteraction,
    snapshot: PetLifeSnapshot,
    now: number,
  ): PetLifeEvent {
    const event = typeof interaction === 'string' ? { type: interaction } : interaction
    if (event.type === 'pet') return event

    const effectiveNow = Math.max(
      snapshot.lastCalculatedAt,
      Number.isFinite(now) ? now : snapshot.lastCalculatedAt,
    )
    const cutoff = effectiveNow - RATE_LIMIT_WINDOW_MS
    const history = event.type === 'click' ? clickHistory : doubleClickHistory
    const activeHistory = history.filter((timestamp) => timestamp > cutoff)
    const limit = event.type === 'click' ? CLICK_LIMIT : DOUBLE_CLICK_LIMIT

    if (event.type === 'click') clickHistory = activeHistory
    else doubleClickHistory = activeHistory

    if (activeHistory.length >= limit) {
      return { type: 'pet', seconds: 0 }
    }

    activeHistory.push(effectiveNow)
    return event
  }

  function rememberTaskResultKey(eventKey: string): boolean {
    if (eventKey.length === 0 || eventKey.length > TASK_RESULT_KEY_MAX_LENGTH) return false
    if (handledTaskResultKeys.has(eventKey)) return false
    if (handledTaskResultKeys.size >= TASK_RESULT_KEY_LIMIT) {
      const oldestKey = handledTaskResultKeys.values().next().value
      if (oldestKey !== undefined) handledTaskResultKeys.delete(oldestKey)
    }
    handledTaskResultKeys.add(eventKey)
    return true
  }

  const initialSnapshot = createInitialSnapshot()

  return {
    snapshot: initialSnapshot,
    form: derivePetForm(initialSnapshot, 'normal'),
    hydrated: false,
    persistenceError: null,

    hydrate: (now = Date.now()) => {
      if (hydratePromise !== null) return hydratePromise

      const generation = storeGeneration
      const barrier = saveQueue
      const hydrateAt = normalizeOperationTime(now)
      hydratePromise = (async () => {
        let loadedSnapshot: PetLifeSnapshot | null

        await barrier
        if (generation !== storeGeneration) return

        try {
          loadedSnapshot = await electronAPI().loadPetLife()
        } catch {
          if (generation !== storeGeneration) return
          loadedSnapshot = null
          writeAllowed = false
          recordPersistenceError(generation)
        }

        if (generation !== storeGeneration) return

        const sourceSnapshot = loadedSnapshot
          ? { ...loadedSnapshot }
          : createInitialSnapshot(hydrateAt)
        let nextSnapshot = settlePetLife(sourceSnapshot, hydrateAt)
        let nextForm = derivePetForm(nextSnapshot, 'normal')
        const operations = pendingOperations
        pendingOperations = []

        clickHistory = clickHistory.map((timestamp) => (
          Math.max(timestamp, nextSnapshot.lastCalculatedAt)
        ))
        doubleClickHistory = doubleClickHistory.map((timestamp) => (
          Math.max(timestamp, nextSnapshot.lastCalculatedAt)
        ))

        for (const operation of operations) {
          nextSnapshot = applyOperation(nextSnapshot, operation)
          nextForm = derivePetForm(nextSnapshot, nextForm)
        }

        set({
          snapshot: nextSnapshot,
          form: nextForm,
          hydrated: true,
        })
        await persist(nextSnapshot)
      })()

      return hydratePromise
    },

    interact: (interaction, now = Date.now()) => {
      const operationAt = normalizeOperationTime(now)
      const event = limitedInteractionEvent(interaction, get().snapshot, operationAt)
      commitOperation({ type: 'event', event, now: operationAt })
    },
    feed: (now = Date.now()) => commitOperation({
      type: 'event',
      event: { type: 'feed' },
      now: normalizeOperationTime(now),
    }),
    sleep: (now = Date.now()) => commitOperation({
      type: 'event',
      event: { type: 'sleep' },
      now: normalizeOperationTime(now),
    }),
    wake: (now = Date.now()) => commitOperation({
      type: 'event',
      event: { type: 'wake' },
      now: normalizeOperationTime(now),
    }),
    tick: (now = Date.now()) => commitOperation({
      type: 'tick',
      now: normalizeOperationTime(now),
    }),
    recordTaskResult: (status, eventKey, now = Date.now()) => {
      if (!rememberTaskResultKey(eventKey)) return
      commitOperation({
        type: 'event',
        event: { type: status === 'finished' ? 'task-success' : 'task-error' },
        now: normalizeOperationTime(now),
      })
    },
    reset: () => {
      storeGeneration += 1
      clickHistory = []
      doubleClickHistory = []
      pendingOperations = []
      handledTaskResultKeys = new Set<string>()
      hydratePromise = null
      writeAllowed = true
      const nextSnapshot = createInitialSnapshot()
      set({
        snapshot: nextSnapshot,
        form: 'normal',
        hydrated: false,
        persistenceError: null,
      })
    },
  }
})
