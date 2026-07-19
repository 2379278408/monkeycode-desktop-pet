import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PetLifeSnapshot } from '../lib/pet-life'
import { usePetLifeStore } from './pet-life-store'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const NOW = 1_000_000_000

function snapshot(overrides: Partial<PetLifeSnapshot> = {}): PetLifeSnapshot {
  return {
    mood: 50,
    satiety: 50,
    energy: 50,
    sleeping: false,
    lastCalculatedAt: NOW,
    lastInteractionAt: NOW,
    ...overrides,
  }
}

function installElectronAPI(loadResult: PetLifeSnapshot | null = null) {
  const loadPetLife = vi.fn().mockResolvedValue(loadResult)
  const savePetLife = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('window', { electronAPI: { loadPetLife, savePetLife } })
  return { loadPetLife, savePetLife }
}

async function waitForSaves(savePetLife: ReturnType<typeof vi.fn>, count: number) {
  await vi.waitFor(() => expect(savePetLife).toHaveBeenCalledTimes(count))
}

describe('usePetLifeStore', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(NOW)
    installElectronAPI()
    usePetLifeStore.getState().reset()
  })

  afterEach(() => {
    usePetLifeStore.getState().reset()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('starts from a safe current snapshot', () => {
    const state = usePetLifeStore.getState()

    expect(state.snapshot).toMatchObject({ mood: 50, satiety: 50, energy: 50, sleeping: false })
    expect(state.snapshot.lastCalculatedAt).toBe(NOW)
    expect(state.snapshot.lastInteractionAt).toBe(NOW)
    expect(state.form).toBe('normal')
    expect(state.hydrated).toBe(false)
    expect(state.persistenceError).toBeNull()
  })

  it('hydrates once, settles offline time, updates form, and saves the settlement', async () => {
    const loaded = snapshot({
      satiety: 40,
      energy: 50,
      lastCalculatedAt: NOW - 10 * HOUR_MS,
      lastInteractionAt: NOW - 10 * HOUR_MS,
    })
    const api = installElectronAPI(loaded)

    await usePetLifeStore.getState().hydrate(NOW)

    expect(api.loadPetLife).toHaveBeenCalledOnce()
    expect(usePetLifeStore.getState()).toMatchObject({
      hydrated: true,
      form: 'hungry',
      snapshot: { mood: 46, satiety: 20, energy: 35, lastCalculatedAt: NOW },
    })
    expect(api.savePetLife).toHaveBeenCalledWith(usePetLifeStore.getState().snapshot)
    expect(loaded).toEqual(snapshot({
      satiety: 40,
      energy: 50,
      lastCalculatedAt: NOW - 10 * HOUR_MS,
      lastInteractionAt: NOW - 10 * HOUR_MS,
    }))
  })

  it('uses and persists the safe initial snapshot when storage is empty', async () => {
    const api = installElectronAPI(null)

    await usePetLifeStore.getState().hydrate(NOW)

    expect(usePetLifeStore.getState()).toMatchObject({
      hydrated: true,
      form: 'normal',
      snapshot: { mood: 50, satiety: 50, energy: 50, sleeping: false },
    })
    expect(api.savePetLife).toHaveBeenCalledOnce()
  })

  it('deduplicates concurrent and later hydration calls', async () => {
    let resolveLoad: ((value: PetLifeSnapshot | null) => void) | undefined
    const loadPetLife = vi.fn(() => new Promise<PetLifeSnapshot | null>((resolve) => {
      resolveLoad = resolve
    }))
    const savePetLife = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', { electronAPI: { loadPetLife, savePetLife } })

    const first = usePetLifeStore.getState().hydrate(NOW)
    const second = usePetLifeStore.getState().hydrate(NOW + HOUR_MS)
    await vi.waitFor(() => expect(loadPetLife).toHaveBeenCalledOnce())
    resolveLoad?.(snapshot())
    await Promise.all([first, second])
    await usePetLifeStore.getState().hydrate(NOW + 2 * HOUR_MS)

    expect(loadPetLife).toHaveBeenCalledOnce()
    expect(savePetLife).toHaveBeenCalledOnce()
  })

  it('replays operations performed during a delayed load and saves only the final snapshot', async () => {
    let resolveLoad: ((value: PetLifeSnapshot | null) => void) | undefined
    const loaded = snapshot({ mood: 40, satiety: 40 })
    const loadPetLife = vi.fn(() => new Promise<PetLifeSnapshot | null>((resolve) => {
      resolveLoad = resolve
    }))
    const savePetLife = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', { electronAPI: { loadPetLife, savePetLife } })

    const hydration = usePetLifeStore.getState().hydrate(NOW)
    usePetLifeStore.getState().feed(NOW + HOUR_MS)
    usePetLifeStore.getState().interact({ type: 'click' }, NOW + HOUR_MS + 1)
    usePetLifeStore.getState().tick(NOW + 2 * HOUR_MS)

    expect(usePetLifeStore.getState().snapshot.mood).toBe(53)
    expect(savePetLife).not.toHaveBeenCalled()

    await vi.waitFor(() => expect(loadPetLife).toHaveBeenCalledOnce())
    resolveLoad?.(loaded)
    await hydration

    expect(usePetLifeStore.getState()).toMatchObject({
      hydrated: true,
      snapshot: { mood: 43, energy: 47, lastCalculatedAt: NOW + 2 * HOUR_MS },
    })
    expect(usePetLifeStore.getState().snapshot.satiety).toBeCloseTo(61)
    expect(savePetLife).toHaveBeenCalledOnce()
    expect(savePetLife).toHaveBeenCalledWith(usePetLifeStore.getState().snapshot)
  })

  it('does not count a pending limited interaction twice during replay', async () => {
    let resolveLoad: ((value: PetLifeSnapshot | null) => void) | undefined
    const loadPetLife = vi.fn(() => new Promise<PetLifeSnapshot | null>((resolve) => {
      resolveLoad = resolve
    }))
    const savePetLife = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', { electronAPI: { loadPetLife, savePetLife } })

    const hydration = usePetLifeStore.getState().hydrate(NOW)
    usePetLifeStore.getState().interact({ type: 'click' }, NOW)
    await vi.waitFor(() => expect(loadPetLife).toHaveBeenCalledOnce())
    resolveLoad?.(snapshot({ mood: 40 }))
    await hydration
    savePetLife.mockClear()

    usePetLifeStore.getState().interact({ type: 'click' }, NOW + 1)
    usePetLifeStore.getState().interact({ type: 'click' }, NOW + 2)
    usePetLifeStore.getState().interact({ type: 'click' }, NOW + 3)

    expect(usePetLifeStore.getState().snapshot.mood).toBe(43)
  })

  it('settles before feed, sleep, wake, and tick and persists every latest snapshot', async () => {
    const api = installElectronAPI(snapshot())
    await usePetLifeStore.getState().hydrate(NOW)
    api.savePetLife.mockClear()

    usePetLifeStore.getState().feed(NOW + HOUR_MS)
    expect(usePetLifeStore.getState().snapshot).toMatchObject({ mood: 52, satiety: 73, energy: 48.5 })
    usePetLifeStore.getState().sleep(NOW + 2 * HOUR_MS)
    expect(usePetLifeStore.getState()).toMatchObject({ form: 'sleeping', snapshot: { sleeping: true } })
    usePetLifeStore.getState().wake(NOW + 3 * HOUR_MS)
    expect(usePetLifeStore.getState()).toMatchObject({ form: 'normal', snapshot: { sleeping: false, energy: 55 } })
    usePetLifeStore.getState().tick(NOW + 4 * HOUR_MS)

    await waitForSaves(api.savePetLife, 4)
    expect(api.savePetLife.mock.calls.map(([saved]) => saved)).toEqual([
      expect.objectContaining({ mood: 52, satiety: 73, energy: 48.5 }),
      expect.objectContaining({ sleeping: true, satiety: 71, energy: 47 }),
      expect.objectContaining({ sleeping: false, satiety: 71, energy: 55 }),
      expect.objectContaining({ sleeping: false, satiety: 69, energy: 53.5 }),
    ])
  })

  it('limits click gains to three and double-click gains to two per rolling window', async () => {
    const api = installElectronAPI(snapshot())
    await usePetLifeStore.getState().hydrate(NOW)
    api.savePetLife.mockClear()

    for (let index = 0; index < 4; index += 1) {
      usePetLifeStore.getState().interact({ type: 'click' }, NOW + index)
    }
    for (let index = 0; index < 3; index += 1) {
      usePetLifeStore.getState().interact({ type: 'double-click' }, NOW + 100 + index)
    }

    expect(usePetLifeStore.getState().snapshot).toMatchObject({
      mood: 59,
      lastInteractionAt: NOW + 102,
    })
    await waitForSaves(api.savePetLife, 7)
  })

  it('expires a rate-limit entry at exactly ten minutes', async () => {
    const api = installElectronAPI(snapshot())
    await usePetLifeStore.getState().hydrate(NOW)

    usePetLifeStore.getState().interact({ type: 'click' }, NOW)
    usePetLifeStore.getState().interact({ type: 'click' }, NOW + 1)
    usePetLifeStore.getState().interact({ type: 'click' }, NOW + 2)
    usePetLifeStore.getState().interact({ type: 'click' }, NOW + 10 * MINUTE_MS - 1)
    expect(usePetLifeStore.getState().snapshot.mood).toBe(53)

    usePetLifeStore.getState().interact({ type: 'click' }, NOW + 10 * MINUTE_MS)
    expect(usePetLifeStore.getState().snapshot.mood).toBe(54)
  })

  it('records over-limit interaction time without adding mood', async () => {
    installElectronAPI(snapshot())
    await usePetLifeStore.getState().hydrate(NOW)

    for (let index = 0; index < 3; index += 1) {
      usePetLifeStore.getState().interact({ type: 'click' }, NOW + index)
    }
    usePetLifeStore.getState().interact({ type: 'click' }, NOW + MINUTE_MS)

    expect(usePetLifeStore.getState().snapshot).toMatchObject({
      mood: 53,
      lastInteractionAt: NOW + MINUTE_MS,
    })
  })

  it('caps each pet interaction at five mood points', async () => {
    installElectronAPI(snapshot({ mood: 40 }))
    await usePetLifeStore.getState().hydrate(NOW)

    usePetLifeStore.getState().interact({ type: 'pet', seconds: 100 }, NOW)
    usePetLifeStore.getState().interact({ type: 'pet', seconds: 4 }, NOW + 1)

    expect(usePetLifeStore.getState().snapshot.mood).toBe(47)
  })

  it('keeps interaction and rate-limit time monotonic when the clock moves backwards', async () => {
    installElectronAPI(snapshot({ lastCalculatedAt: NOW + MINUTE_MS, lastInteractionAt: NOW + MINUTE_MS }))
    await usePetLifeStore.getState().hydrate(NOW)

    for (let index = 0; index < 4; index += 1) {
      usePetLifeStore.getState().interact({ type: 'click' }, NOW - index)
    }

    expect(usePetLifeStore.getState().snapshot).toMatchObject({
      mood: 53,
      lastCalculatedAt: NOW + MINUTE_MS,
      lastInteractionAt: NOW + MINUTE_MS,
    })
  })

  it('serializes saves in operation order', async () => {
    const loaded = snapshot()
    const loadPetLife = vi.fn().mockResolvedValue(loaded)
    let resolveFirstSave: (() => void) | undefined
    const savePetLife = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        resolveFirstSave = resolve
      }))
      .mockResolvedValueOnce(undefined)
    vi.stubGlobal('window', { electronAPI: { loadPetLife, savePetLife } })
    await usePetLifeStore.getState().hydrate(NOW)
    savePetLife.mockClear()

    usePetLifeStore.getState().feed(NOW)
    usePetLifeStore.getState().sleep(NOW + 1)

    await vi.waitFor(() => expect(savePetLife).toHaveBeenCalledTimes(1))
    expect(savePetLife.mock.calls[0][0]).toMatchObject({ satiety: 75, sleeping: false })
    resolveFirstSave?.()
    await waitForSaves(savePetLife, 2)
    expect(savePetLife.mock.calls[1][0]).toMatchObject({ sleeping: true })
    expect(savePetLife.mock.calls[1][0].satiety).toBeCloseTo(75)
  })

  it('keeps a new generation save behind an unfinished old generation save', async () => {
    const loadPetLife = vi.fn().mockResolvedValue(null)
    let resolveOldSave: (() => void) | undefined
    const savePetLife = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        resolveOldSave = resolve
      }))
      .mockResolvedValueOnce(undefined)
    vi.stubGlobal('window', { electronAPI: { loadPetLife, savePetLife } })
    await usePetLifeStore.getState().hydrate(NOW)
    savePetLife.mockClear()

    usePetLifeStore.getState().feed(NOW)
    await vi.waitFor(() => expect(savePetLife).toHaveBeenCalledOnce())
    usePetLifeStore.getState().reset()
    const newHydration = usePetLifeStore.getState().hydrate(NOW + HOUR_MS)

    expect(savePetLife).toHaveBeenCalledOnce()
    resolveOldSave?.()
    await newHydration

    expect(savePetLife).toHaveBeenCalledTimes(2)
    expect(savePetLife.mock.calls[0][0]).toMatchObject({ satiety: 75 })
    expect(savePetLife.mock.calls[1][0]).toMatchObject({ satiety: 50 })
  })

  it('waits for every old generation save before a new generation load', async () => {
    const loadPetLife = vi.fn().mockResolvedValue(null)
    const saveResolvers: Array<() => void> = []
    const savePetLife = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', { electronAPI: { loadPetLife, savePetLife } })
    await usePetLifeStore.getState().hydrate(NOW)
    loadPetLife.mockClear()
    savePetLife.mockReset()
      .mockImplementationOnce(() => new Promise<void>((resolve) => saveResolvers.push(resolve)))
      .mockImplementationOnce(() => new Promise<void>((resolve) => saveResolvers.push(resolve)))
      .mockResolvedValueOnce(undefined)

    usePetLifeStore.getState().feed(NOW)
    usePetLifeStore.getState().sleep(NOW + 1)
    await vi.waitFor(() => expect(savePetLife).toHaveBeenCalledTimes(1))
    usePetLifeStore.getState().reset()
    const hydration = usePetLifeStore.getState().hydrate(NOW + HOUR_MS)

    try {
      await Promise.resolve()
      expect(loadPetLife).not.toHaveBeenCalled()
      saveResolvers[0]?.()
      await vi.waitFor(() => expect(savePetLife).toHaveBeenCalledTimes(2))
      expect(loadPetLife).not.toHaveBeenCalled()
      saveResolvers[1]?.()
      await hydration

      expect(loadPetLife).toHaveBeenCalledOnce()
      expect(savePetLife).toHaveBeenCalledTimes(3)
      expect(savePetLife.mock.invocationCallOrder[0]).toBeLessThan(savePetLife.mock.invocationCallOrder[1])
      expect(savePetLife.mock.invocationCallOrder[1]).toBeLessThan(loadPetLife.mock.invocationCallOrder[0])
      expect(loadPetLife.mock.invocationCallOrder[0]).toBeLessThan(savePetLife.mock.invocationCallOrder[2])
    } finally {
      for (let index = 0; index < 3; index += 1) {
        for (const resolve of saveResolvers.splice(0)) resolve()
        await Promise.resolve()
      }
      await hydration.catch(() => undefined)
    }
  })

  it('rebases startup click history when loaded time is one hour ahead', async () => {
    let resolveLoad: ((value: PetLifeSnapshot | null) => void) | undefined
    const loadPetLife = vi.fn(() => new Promise<PetLifeSnapshot | null>((resolve) => {
      resolveLoad = resolve
    }))
    const savePetLife = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', { electronAPI: { loadPetLife, savePetLife } })
    const hydration = usePetLifeStore.getState().hydrate(NOW)

    usePetLifeStore.getState().interact({ type: 'click' }, NOW)
    usePetLifeStore.getState().interact({ type: 'click' }, NOW + 1)
    usePetLifeStore.getState().interact({ type: 'click' }, NOW + 2)
    await vi.waitFor(() => expect(loadPetLife).toHaveBeenCalledOnce())
    resolveLoad?.(snapshot({
      mood: 40,
      lastCalculatedAt: NOW + HOUR_MS,
      lastInteractionAt: NOW + HOUR_MS,
    }))
    await hydration

    expect(usePetLifeStore.getState().snapshot.mood).toBe(43)
    usePetLifeStore.getState().interact({ type: 'click' }, NOW + 3)
    expect(usePetLifeStore.getState().snapshot.mood).toBe(43)
  })

  it('keeps memory state and records only the first save failure without an unhandled rejection', async () => {
    const api = installElectronAPI(snapshot())
    await usePetLifeStore.getState().hydrate(NOW)
    api.savePetLife.mockReset()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockRejectedValueOnce(new Error('still full'))

    usePetLifeStore.getState().feed(NOW)
    usePetLifeStore.getState().sleep(NOW + 1)

    await waitForSaves(api.savePetLife, 2)
    await vi.waitFor(() => expect(usePetLifeStore.getState().persistenceError)
      .toBe('生命状态暂时无法保存，请稍后重试'))
    expect(usePetLifeStore.getState().snapshot).toMatchObject({ sleeping: true })
    expect(usePetLifeStore.getState().snapshot.satiety).toBeCloseTo(75)
  })

  it('preserves pending operations but blocks writes when loading fails', async () => {
    let rejectLoad: ((error: Error) => void) | undefined
    const loadPetLife = vi.fn(() => new Promise<PetLifeSnapshot | null>((_resolve, reject) => {
      rejectLoad = reject
    }))
    const savePetLife = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', { electronAPI: { loadPetLife, savePetLife } })

    const hydration = usePetLifeStore.getState().hydrate(NOW)
    usePetLifeStore.getState().feed(NOW)
    await vi.waitFor(() => expect(loadPetLife).toHaveBeenCalledOnce())
    rejectLoad?.(new Error('secret path /users/alice/pet-life.json'))
    await hydration

    expect(usePetLifeStore.getState()).toMatchObject({
      hydrated: true,
      persistenceError: '生命状态暂时无法保存，请稍后重试',
      snapshot: { mood: 52, satiety: 75, energy: 50, sleeping: false },
    })
    expect(savePetLife).not.toHaveBeenCalled()

    usePetLifeStore.getState().feed(NOW + 1)
    await Promise.resolve()
    expect(usePetLifeStore.getState().snapshot.mood).toBe(54)
    expect(usePetLifeStore.getState().snapshot.satiety).toBeCloseTo(100)
    expect(savePetLife).not.toHaveBeenCalled()
  })

  it('retries persistence after the recovery save fails', async () => {
    const loadPetLife = vi.fn().mockResolvedValue(null)
    const savePetLife = vi.fn()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValueOnce(undefined)
    vi.stubGlobal('window', { electronAPI: { loadPetLife, savePetLife } })

    await usePetLifeStore.getState().hydrate(NOW)

    expect(usePetLifeStore.getState()).toMatchObject({
      hydrated: true,
      persistenceError: '生命状态暂时无法保存，请稍后重试',
    })
    expect(savePetLife).toHaveBeenCalledOnce()

    usePetLifeStore.getState().interact({ type: 'click' }, NOW + 1)
    await waitForSaves(savePetLife, 2)

    expect(savePetLife).toHaveBeenCalledTimes(2)
    expect(savePetLife.mock.calls[1][0]).toEqual(usePetLifeStore.getState().snapshot)
    expect(usePetLifeStore.getState().persistenceError).toBeNull()
  })

  it('keeps the final error after failure, success, then failure', async () => {
    const api = installElectronAPI(snapshot())
    await usePetLifeStore.getState().hydrate(NOW)
    api.savePetLife.mockReset()
      .mockRejectedValueOnce(new Error('first failure'))
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('final failure'))
    const errorTransitions: Array<string | null> = []
    let previousError = usePetLifeStore.getState().persistenceError
    const unsubscribe = usePetLifeStore.subscribe((state) => {
      if (state.persistenceError === previousError) return
      previousError = state.persistenceError
      errorTransitions.push(state.persistenceError)
    })

    try {
      usePetLifeStore.getState().feed(NOW)
      usePetLifeStore.getState().sleep(NOW + 1)
      usePetLifeStore.getState().wake(NOW + 2)
      await waitForSaves(api.savePetLife, 3)
      await vi.waitFor(() => expect(errorTransitions).toEqual([
        '生命状态暂时无法保存，请稍后重试',
        null,
        '生命状态暂时无法保存，请稍后重试',
      ]))

      expect(usePetLifeStore.getState().persistenceError)
        .toBe('生命状态暂时无法保存，请稍后重试')
    } finally {
      unsubscribe()
    }
  })

  it('ignores an old generation save failure after reset', async () => {
    const api = installElectronAPI(snapshot())
    await usePetLifeStore.getState().hydrate(NOW)
    let rejectOldSave: ((error: Error) => void) | undefined
    api.savePetLife.mockReset()
      .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
        rejectOldSave = reject
      }))
      .mockResolvedValueOnce(undefined)

    usePetLifeStore.getState().feed(NOW)
    await vi.waitFor(() => expect(api.savePetLife).toHaveBeenCalledOnce())
    usePetLifeStore.getState().reset()
    const errorTransitions: Array<string | null> = []
    let previousError = usePetLifeStore.getState().persistenceError
    const unsubscribe = usePetLifeStore.subscribe((state) => {
      if (state.persistenceError === previousError) return
      previousError = state.persistenceError
      errorTransitions.push(state.persistenceError)
    })

    try {
      const hydration = usePetLifeStore.getState().hydrate(NOW + HOUR_MS)
      rejectOldSave?.(new Error('old generation failure'))
      await hydration

      expect(api.loadPetLife).toHaveBeenCalledTimes(2)
      expect(api.savePetLife).toHaveBeenCalledTimes(2)
      expect(errorTransitions).toEqual([])
      expect(usePetLifeStore.getState()).toMatchObject({
        hydrated: true,
        persistenceError: null,
      })
    } finally {
      unsubscribe()
    }
  })

  it('records task results once per stable event key', async () => {
    const api = installElectronAPI(snapshot())
    await usePetLifeStore.getState().hydrate(NOW)
    api.savePetLife.mockClear()

    usePetLifeStore.getState().recordTaskResult('finished', 'task-1:finished:1', NOW)
    expect(usePetLifeStore.getState().snapshot.mood).toBe(52)
    usePetLifeStore.getState().recordTaskResult('finished', 'task-1:finished:1', NOW + 1)
    expect(usePetLifeStore.getState().snapshot.mood).toBe(52)
    usePetLifeStore.getState().recordTaskResult('error', 'task-2:error:2', NOW + 2)

    expect(usePetLifeStore.getState().snapshot.mood).toBe(50)
    await waitForSaves(api.savePetLife, 2)

    usePetLifeStore.getState().reset()
    usePetLifeStore.getState().recordTaskResult('finished', 'task-1:finished:1', NOW)
    expect(usePetLifeStore.getState().snapshot.mood).toBe(52)
  })

  it('normalizes initial timestamps to non-negative safe integers', () => {
    vi.setSystemTime(-123.75)

    usePetLifeStore.getState().reset()

    expect(usePetLifeStore.getState().snapshot).toMatchObject({
      lastCalculatedAt: 0,
      lastInteractionAt: 0,
    })
    expect(Number.isSafeInteger(usePetLifeStore.getState().snapshot.lastCalculatedAt)).toBe(true)
  })

  it('normalizes every public operation time before applying and saving', async () => {
    const api = installElectronAPI(snapshot())
    await usePetLifeStore.getState().hydrate(NOW)
    api.savePetLife.mockClear()

    usePetLifeStore.getState().tick(Number.MAX_VALUE)
    usePetLifeStore.getState().feed(Number.NaN)
    usePetLifeStore.getState().interact({ type: 'pet', seconds: 2 }, NOW + 123.9)
    usePetLifeStore.getState().sleep(Number.POSITIVE_INFINITY)
    usePetLifeStore.getState().wake(-1)
    usePetLifeStore.getState().recordTaskResult('finished', 'safe-time', NOW + 456.8)

    await waitForSaves(api.savePetLife, 6)
    expect(usePetLifeStore.getState().snapshot.lastCalculatedAt).toBe(NOW + 456)
    for (const [saved] of api.savePetLife.mock.calls) {
      expect(Number.isSafeInteger(saved.lastCalculatedAt)).toBe(true)
      expect(Number.isSafeInteger(saved.lastInteractionAt)).toBe(true)
      expect(saved.lastCalculatedAt).toBeGreaterThanOrEqual(0)
      expect(saved.lastInteractionAt).toBeGreaterThanOrEqual(0)
    }
  })

  it('accepts one hour of future skew and rejects operation times beyond 24 hours', async () => {
    const api = installElectronAPI(snapshot())
    await usePetLifeStore.getState().hydrate(NOW)
    api.savePetLife.mockClear()

    usePetLifeStore.getState().tick(Number.MAX_SAFE_INTEGER)
    expect(usePetLifeStore.getState().snapshot.lastCalculatedAt).toBe(NOW)
    usePetLifeStore.getState().tick(NOW + 24 * HOUR_MS + 1)
    expect(usePetLifeStore.getState().snapshot.lastCalculatedAt).toBe(NOW)
    usePetLifeStore.getState().tick(NOW + HOUR_MS)

    expect(usePetLifeStore.getState().snapshot.lastCalculatedAt).toBe(NOW + HOUR_MS)
    await waitForSaves(api.savePetLife, 3)
  })

  it('ignores empty and oversized task result keys while accepting 512 code units', async () => {
    const api = installElectronAPI(snapshot())
    await usePetLifeStore.getState().hydrate(NOW)
    api.savePetLife.mockClear()

    usePetLifeStore.getState().recordTaskResult('finished', '', NOW)
    usePetLifeStore.getState().recordTaskResult('finished', 'x'.repeat(513), NOW)
    expect(usePetLifeStore.getState().snapshot.mood).toBe(50)
    expect(api.savePetLife).not.toHaveBeenCalled()

    usePetLifeStore.getState().recordTaskResult('finished', 'x'.repeat(512), NOW)
    expect(usePetLifeStore.getState().snapshot.mood).toBe(52)
    await waitForSaves(api.savePetLife, 1)
  })

  it('evicts the oldest task result key after the fixed capacity', async () => {
    const api = installElectronAPI(snapshot())
    await usePetLifeStore.getState().hydrate(NOW)
    api.savePetLife.mockClear()

    for (let index = 0; index < 257; index += 1) {
      usePetLifeStore.getState().recordTaskResult(
        index % 2 === 0 ? 'finished' : 'error',
        `task-result-${index}`,
        NOW + index,
      )
    }
    usePetLifeStore.getState().recordTaskResult('finished', 'task-result-256', NOW + 300)
    expect(usePetLifeStore.getState().snapshot.mood).toBe(52)
    usePetLifeStore.getState().recordTaskResult('finished', 'task-result-0', NOW + 301)

    expect(usePetLifeStore.getState().snapshot.mood).toBe(54)
    await waitForSaves(api.savePetLife, 258)
  })
})
