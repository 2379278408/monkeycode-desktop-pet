import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PetState } from '../stores/pet-store'
import { classifyReleaseIntent, type GestureSession } from '../lib/pointer-gesture'
import {
  PET_LIFE_TICK_MS,
  PetShell,
  appendBoundedGesturePoint,
  applyDesiredCardVisibility,
  createPendingClickCoordinator,
  finishDragWithPendingClick,
  isPointInsideRect,
  petActionDuration,
  pettingDurationSeconds,
  runLatestStoreDoubleClick,
  runLatestStoreClick,
  settlePointerRelease,
  shouldSettleScheduledClick,
  startPetLifeClock,
  taskResultEventKey,
  toggleDesiredCardVisibility,
} from './PetShell'

const storeHarness = vi.hoisted(() => ({ petState: 'IDLE' }))
const lifeStoreHarness = vi.hoisted(() => ({
  snapshot: {
    mood: 50,
    satiety: 50,
    energy: 50,
    sleeping: false,
    lastCalculatedAt: 1,
    lastInteractionAt: 1,
  },
  form: 'normal',
  hydrated: true,
  persistenceError: null,
  hydrate: vi.fn(),
  interact: vi.fn(),
  feed: vi.fn(),
  sleep: vi.fn(),
  wake: vi.fn(),
  tick: vi.fn(),
  recordTaskResult: vi.fn(),
}))

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

vi.mock('../stores/pet-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../stores/pet-store')>()
  return {
    ...actual,
    usePetStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
      petState: storeHarness.petState,
      recentTaskEvent: null,
      updateFromAPI: () => {},
    }),
  }
})

vi.mock('../stores/pet-life-store', () => {
  const usePetLifeStore = (selector: (state: typeof lifeStoreHarness) => unknown) => selector(lifeStoreHarness)
  usePetLifeStore.getState = () => lifeStoreHarness
  return { usePetLifeStore }
})

const expectedAssetByState: Record<PetState, string> = {
  [PetState.IDLE]: 'normal.svg',
  [PetState.WORKING]: 'normal.svg',
  [PetState.SUCCESS]: 'success.svg',
  [PetState.ERROR]: 'error.svg',
  [PetState.QUOTA_LOW]: 'quota-low.svg',
}

describe('PetShell sprite compatibility', () => {
  it.each(Object.values(PetState))('maps %s through the production action selector', (petState) => {
    storeHarness.petState = petState

    const markup = renderToStaticMarkup(createElement(PetShell, {
      onLogout: async () => {},
    }))

    expect(markup).toContain(`/assets/monkey/${expectedAssetByState[petState]}`)
  })

  it('uses the hydrated life form when business state is idle', () => {
    storeHarness.petState = PetState.IDLE
    lifeStoreHarness.form = 'hungry'

    const markup = renderToStaticMarkup(createElement(PetShell, {
      onLogout: async () => {},
    }))

    expect(markup).toContain('/assets/monkey/hungry.svg')
    expect(markup).toContain('MonkeyCode 猴子肚子饿了')
    lifeStoreHarness.form = 'normal'
  })
})

describe('PetShell life integration helpers', () => {
  it('uses a stable one-minute life tick interval', () => {
    expect(PET_LIFE_TICK_MS).toBe(60_000)
  })

  it('hydrates immediately, ticks every minute, and clears the clock', async () => {
    vi.useFakeTimers()
    const hydrate = vi.fn().mockRejectedValue(new Error('load failed'))
    const tick = vi.fn()
    const now = vi.fn()
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(70)
      .mockReturnValueOnce(130)

    try {
      const stop = startPetLifeClock({ hydrate, tick }, now)
      expect(hydrate).toHaveBeenCalledWith(10)
      await vi.advanceTimersByTimeAsync(PET_LIFE_TICK_MS * 2)
      expect(tick).toHaveBeenNthCalledWith(1, 70)
      expect(tick).toHaveBeenNthCalledWith(2, 130)

      stop()
      await vi.advanceTimersByTimeAsync(PET_LIFE_TICK_MS)
      expect(tick).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('creates the store-compatible terminal task key', () => {
    expect(taskResultEventKey({
      task_id: 'task-7',
      status: 'finished',
      occurred_at: 123,
    })).toBe(JSON.stringify(['task-7', 'finished', 123]))
  })

  it('defines interruptible temporary action durations', () => {
    expect(petActionDuration('waving')).toBe(1_500)
    expect(petActionDuration('celebrating')).toBe(1_500)
    expect(petActionDuration('petting')).toBe(1_500)
    expect(petActionDuration('dropping')).toBe(360)
    expect(petActionDuration('eating')).toBe(1_500)
    expect(petActionDuration('falling-asleep')).toBe(1_500)
    expect(petActionDuration('waking')).toBe(1_000)
  })

  it('clamps petting time to non-negative seconds', () => {
    expect(pettingDurationSeconds(1_350, 3_500)).toBe(2.15)
    expect(pettingDurationSeconds(3_500, 1_000)).toBe(0)
  })
})

describe('pet gesture bounds', () => {
  const rect = { left: 10, right: 30, top: 20, bottom: 40 }
  const inside = { x: 20, y: 30 }
  const makeGesture = (): GestureSession => ({
    points: [{ x: 0, y: 0, at: 0 }],
    previousClickAt: null,
    lockedIntent: null,
  })

  it.each([
    { x: 10, y: 20 },
    { x: 30, y: 40 },
    { x: 10, y: 40 },
    { x: 30, y: 20 },
  ])('includes the rectangle boundary at $x,$y', (point) => {
    expect(isPointInsideRect(point, rect)).toBe(true)
  })

  it.each([
    { rect: { left: Number.NaN, right: 30, top: 20, bottom: 40 } },
    { rect: { left: 10, right: Number.POSITIVE_INFINITY, top: 20, bottom: 40 } },
    { rect: { left: 30, right: 10, top: 20, bottom: 40 } },
  ])('rejects an invalid rectangle', ({ rect: invalidRect }) => {
    expect(isPointInsideRect({ x: 20, y: 30 }, invalidRect)).toBe(false)
  })

  it('cancels before an outside release can complete pet distance', () => {
    let gesture = appendBoundedGesturePoint(
      makeGesture(), { x: 0, y: 0, at: 350 }, inside, rect,
    )
    gesture = appendBoundedGesturePoint(gesture, { x: 20, y: 0, at: 400 }, inside, rect)
    gesture = appendBoundedGesturePoint(gesture, { x: 0, y: 0, at: 450 }, inside, rect)
    gesture = appendBoundedGesturePoint(gesture, { x: 20, y: 0, at: 500 }, inside, rect)
    const pointCountBeforeRelease = gesture.points.length

    gesture = appendBoundedGesturePoint(
      gesture, { x: 40, y: 0, at: 550 }, { x: 31, y: 30 }, rect,
    )

    expect(gesture.lockedIntent).toBe('pet-cancelled')
    expect(gesture.points).toHaveLength(pointCountBeforeRelease)
    expect(classifyReleaseIntent(gesture)).toBeNull()
  })

  it('cancels a timer-created candidate after sub-threshold movement leaves the bounds', () => {
    let gesture = appendBoundedGesturePoint(
      makeGesture(), { x: 4, y: 0, at: 300 }, { x: 31, y: 30 }, rect,
    )
    expect(gesture.lockedIntent).toBeNull()

    gesture = appendBoundedGesturePoint(
      gesture, { x: 4, y: 0, at: 350 }, { x: 31, y: 30 }, rect,
    )

    expect(gesture.lockedIntent).toBe('pet-cancelled')
    expect(classifyReleaseIntent(gesture)).toBeNull()
  })

  it.each([
    null,
    { left: Number.NaN, right: 30, top: 20, bottom: 40 },
  ])('cancels a candidate with unavailable or invalid bounds', (bounds) => {
    const candidate = appendBoundedGesturePoint(
      makeGesture(), { x: 0, y: 0, at: 350 }, inside, rect,
    )
    const gesture = appendBoundedGesturePoint(
      candidate, { x: 20, y: 0, at: 400 }, inside, bounds,
    )

    expect(gesture.lockedIntent).toBe('pet-cancelled')
    expect(classifyReleaseIntent(gesture)).toBeNull()
  })

  it.each([
    { point: { x: 1, y: 1, at: 100 }, expected: 'click' },
    { point: { x: 3, y: 4, at: 100 }, expected: 'drag' },
  ] as const)('preserves $expected when bounds are unavailable', ({ point, expected }) => {
    const gesture = appendBoundedGesturePoint(makeGesture(), point, inside, null)

    expect(classifyReleaseIntent(gesture)).toBe(expected)
  })

  it('recognizes an in-bounds pet path', () => {
    let gesture = appendBoundedGesturePoint(
      makeGesture(), { x: 0, y: 0, at: 350 }, inside, rect,
    )
    gesture = appendBoundedGesturePoint(gesture, { x: 30, y: 0, at: 400 }, inside, rect)
    gesture = appendBoundedGesturePoint(gesture, { x: 0, y: 0, at: 450 }, inside, rect)
    gesture = appendBoundedGesturePoint(gesture, { x: 20, y: 0, at: 500 }, inside, rect)

    expect(gesture.lockedIntent).toBe('pet')
    expect(classifyReleaseIntent(gesture)).toBe('pet')
  })

  it('keeps a locked pet stable outside invalid or unavailable bounds', () => {
    let gesture = appendBoundedGesturePoint(
      makeGesture(), { x: 0, y: 0, at: 350 }, inside, rect,
    )
    gesture = appendBoundedGesturePoint(gesture, { x: 30, y: 0, at: 400 }, inside, rect)
    gesture = appendBoundedGesturePoint(gesture, { x: 0, y: 0, at: 450 }, inside, rect)
    gesture = appendBoundedGesturePoint(gesture, { x: 20, y: 0, at: 500 }, inside, rect)
    const pointCountBeforeLeaving = gesture.points.length

    gesture = appendBoundedGesturePoint(
      gesture, { x: 500, y: 500, at: 550 }, { x: 500, y: 500 }, null,
    )

    expect(gesture.lockedIntent).toBe('pet')
    expect(gesture.points).toHaveLength(pointCountBeforeLeaving + 1)
    expect(classifyReleaseIntent(gesture)).toBe('pet')
  })
})

describe('pending click coordination', () => {
  it('defers a due click until a non-double pointer session settles', () => {
    const coordinator = createPendingClickCoordinator()
    coordinator.markDue()

    expect(coordinator.settle('pet')).toBe(true)
    expect(coordinator.settle('pet')).toBe(false)
  })

  it.each([
    ['double-click', false],
    ['click', true],
    ['pet', true],
    [null, true],
  ] as const)('settles a due first click for %s with %s', (intent, expected) => {
    vi.useFakeTimers()
    try {
      const coordinator = createPendingClickCoordinator()
      coordinator.markDue()

      expect(coordinator.settle(intent)).toBe(expected)
      expect(coordinator.settle(intent)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears a due click on cancellation', () => {
    vi.useFakeTimers()
    try {
      const coordinator = createPendingClickCoordinator()
      coordinator.markDue()
      coordinator.cancel()

      expect(coordinator.settle('pet')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not commit while the second pointer session is active', async () => {
    vi.useFakeTimers()
    try {
      const commit = vi.fn()
      const coordinator = createPendingClickCoordinator()
      const activeSession = { current: true }
      setTimeout(() => {
        if (activeSession.current) coordinator.markDue()
        else commit()
      }, 301)

      await vi.advanceTimersByTimeAsync(301)
      expect(commit).not.toHaveBeenCalled()

      activeSession.current = false
      if (coordinator.settle('pet')) commit()
      expect(commit).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('prevents a cancelled timer from committing after its deadline', async () => {
    vi.useFakeTimers()
    try {
      const commit = vi.fn()
      const coordinator = createPendingClickCoordinator()
      const timer = setTimeout(commit, 301)

      clearTimeout(timer)
      coordinator.cancel()
      await vi.advanceTimersByTimeAsync(301)

      expect(commit).not.toHaveBeenCalled()
      expect(coordinator.settle('click')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    ['before deadline', 'click', 100],
    ['before deadline', 'pet', 100],
    ['before deadline', null, 100],
    ['before deadline', 'drag', 100],
    ['after deadline', 'click', 400],
    ['after deadline', 'pet', 400],
    ['after deadline', null, 400],
    ['after deadline', 'drag', 400],
  ] as const)(
    'settles one scheduled first click %s before a second %s intent',
    async (_timing, intent, elapsed) => {
      vi.useFakeTimers()
      try {
        vi.setSystemTime(0)
        const events: string[] = []
        const coordinator = createPendingClickCoordinator()
        const firstTimer = setTimeout(() => events.push('stale-first-timer'), 301)
        vi.setSystemTime(elapsed)

        const hasScheduled = vi.getTimerCount() === 1
        if (shouldSettleScheduledClick(intent, hasScheduled)) {
          clearTimeout(firstTimer)
        }
        const terminal = settlePointerRelease(coordinator, intent, hasScheduled, false)
        if (intent === 'drag') {
          await finishDragWithPendingClick(
            () => Promise.resolve(true),
            terminal.shouldCommit,
            () => events.push('first-click'),
            () => events.push('drag-complete'),
          )
        } else {
          if (terminal.shouldCommit) events.push('first-click')
          events.push(intent === null ? 'null-release' : intent)
        }

        if (intent === 'click') setTimeout(() => events.push('second-click'), 301)
        await vi.advanceTimersByTimeAsync(300)

        expect(events).toEqual(intent === 'drag'
          ? ['first-click', 'drag-complete']
          : ['first-click', intent === null ? 'null-release' : intent])
        expect(events.filter((event) => event === 'first-click')).toHaveLength(1)
      } finally {
        vi.useRealTimers()
      }
    },
  )

  it.each([100, 400])(
    'cancels a scheduled first click on double-click at %sms',
    (elapsed) => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(0)
      const coordinator = createPendingClickCoordinator()
      const timer = setTimeout(vi.fn(), 301)
      vi.setSystemTime(elapsed)
      const hasScheduled = vi.getTimerCount() === 1

      expect(shouldSettleScheduledClick('double-click', hasScheduled)).toBe(false)
      clearTimeout(timer)
      expect(settlePointerRelease(
        coordinator,
        'double-click',
        hasScheduled,
        false,
      ).shouldCommit).toBe(false)
    } finally {
      vi.useRealTimers()
    }
    },
  )
})

describe('latest store click execution', () => {
  it('reads the latest sleeping state and wakes immediately in order', () => {
    vi.useFakeTimers()
    try {
      const events: string[] = []
      let sleeping = false
      const getState = vi.fn(() => ({
        snapshot: { sleeping },
        wake: vi.fn(() => events.push('wake')),
        interact: vi.fn(() => events.push('interact')),
      }))
      const commands = {
        getState,
        now: () => 42,
        clearPreviousClick: vi.fn(() => events.push('clear-previous')),
        showLifeAction: vi.fn(() => events.push('waking-action')),
        showInteractionAction: vi.fn(() => events.push('wave-action')),
        toggleCard: vi.fn(() => events.push('toggle-card')),
      }

      sleeping = true
      runLatestStoreClick(commands)

      expect(getState).toHaveBeenCalledOnce()
      expect(events).toEqual(['wake', 'waking-action', 'clear-previous'])
      expect(commands.showInteractionAction).not.toHaveBeenCalled()
      expect(commands.toggleCard).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('interacts, waves, and toggles the card when awake', () => {
    vi.useFakeTimers()
    try {
      const events: string[] = []
      const interact = vi.fn(() => events.push('interact'))
      const toggleCard = vi.fn(() => events.push('toggle-card'))
      runLatestStoreClick({
        getState: () => ({
          snapshot: { sleeping: false },
          wake: vi.fn(() => events.push('wake')),
          interact,
        }),
        now: () => 73,
        clearPreviousClick: vi.fn(() => events.push('clear-previous')),
        showLifeAction: vi.fn(() => events.push('waking-action')),
        showInteractionAction: vi.fn(() => events.push('wave-action')),
        toggleCard,
      })

      expect(interact).toHaveBeenCalledWith('click', 73)
      expect(events).toEqual(['interact', 'wave-action', 'toggle-card'])
      expect(toggleCard).toHaveBeenCalledWith(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('wakes a sleeping classified double-click without celebrating', () => {
    vi.useFakeTimers()
    try {
      const events: string[] = []
      runLatestStoreDoubleClick({
        getState: () => ({
          snapshot: { sleeping: true },
          wake: vi.fn(() => events.push('wake')),
          interact: vi.fn(() => events.push('double-interact')),
        }),
        now: () => 91,
        clearPreviousClick: vi.fn(() => events.push('clear-previous')),
        showLifeAction: vi.fn(() => events.push('waking-action')),
        showInteractionAction: vi.fn(() => events.push('celebrating')),
      })

      expect(events).toEqual(['wake', 'waking-action', 'clear-previous'])
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    ['fast scheduled', true, false],
    ['timer already due', false, true],
  ] as const)('handles a %s sleeping click with one wake', (_name, hasScheduled, alreadyDue) => {
    vi.useFakeTimers()
    try {
      const events: string[] = []
      const coordinator = createPendingClickCoordinator()
      if (alreadyDue) coordinator.markDue()
      const terminal = settlePointerRelease(coordinator, 'click', hasScheduled, true)
      const commands = {
        getState: () => ({
          snapshot: { sleeping: true },
          wake: vi.fn(() => events.push('wake')),
          interact: vi.fn(() => events.push('interact')),
        }),
        now: () => 92,
        clearPreviousClick: vi.fn(() => events.push('clear-previous')),
        showLifeAction: vi.fn(() => events.push('waking-action')),
        showInteractionAction: vi.fn(() => events.push('waving')),
        toggleCard: vi.fn(() => events.push('toggle')),
      }

      if (terminal.shouldCommit) runLatestStoreClick(commands)
      if (!terminal.skipCurrentClick) runLatestStoreClick(commands)

      expect(events).toEqual(['wake', 'waking-action', 'clear-previous'])
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('card visibility coordination', () => {
  it('reverses the desired state across toggles before state commits', () => {
    const desired = { current: false }

    expect(toggleDesiredCardVisibility(desired)).toBe(true)
    expect(toggleDesiredCardVisibility(desired)).toBe(false)
  })

  it('serializes a reversed target and rolls back the failed latest target', async () => {
    const state = { actual: false, desired: true, shown: false }
    const calls: boolean[] = []
    const deferred: Array<ReturnType<typeof createDeferred<void>>> = []
    let concurrency = 0
    let maxConcurrency = 0
    const operation = applyDesiredCardVisibility({
      getActual: () => state.actual,
      getDesired: () => state.desired,
      isActive: () => true,
      setActual: (value) => { state.actual = value },
      setDesired: (value) => { state.desired = value },
      apply: (target) => {
        calls.push(target)
        concurrency += 1
        maxConcurrency = Math.max(maxConcurrency, concurrency)
        const next = createDeferred<void>()
        deferred.push(next)
        return next.promise.finally(() => { concurrency -= 1 })
      },
      onApplied: (target) => { state.shown = target },
      onFailed: vi.fn(),
    })

    expect(calls).toEqual([true])
    state.desired = false
    deferred[0].resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(calls).toEqual([true, false])
    deferred[1].reject(new Error('collapse failed'))
    await operation

    expect(state).toEqual({ actual: true, desired: true, shown: true })
    expect(maxConcurrency).toBe(1)
  })

  it('serializes two successful targets and ends collapsed', async () => {
    const state = { actual: false, desired: true, shown: false }
    const calls: boolean[] = []
    const deferred: Array<ReturnType<typeof createDeferred<void>>> = []
    let concurrency = 0
    let maxConcurrency = 0
    const operation = applyDesiredCardVisibility({
      getActual: () => state.actual,
      getDesired: () => state.desired,
      isActive: () => true,
      setActual: (value) => { state.actual = value },
      setDesired: (value) => { state.desired = value },
      apply: (target) => {
        calls.push(target)
        concurrency += 1
        maxConcurrency = Math.max(maxConcurrency, concurrency)
        const next = createDeferred<void>()
        deferred.push(next)
        return next.promise.finally(() => { concurrency -= 1 })
      },
      onApplied: (target) => { state.shown = target },
      onFailed: vi.fn(),
    })

    state.desired = false
    deferred[0].resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    deferred[1].resolve()
    await operation

    expect(calls).toEqual([true, false])
    expect(state).toEqual({ actual: false, desired: false, shown: false })
    expect(maxConcurrency).toBe(1)
  })

  it('keeps the collapsed state when the first target fails', async () => {
    const state = { actual: false, desired: true, shown: false }
    const failed = vi.fn()

    await applyDesiredCardVisibility({
      getActual: () => state.actual,
      getDesired: () => state.desired,
      isActive: () => true,
      setActual: (value) => { state.actual = value },
      setDesired: (value) => { state.desired = value },
      apply: () => Promise.reject(new Error('expand failed')),
      onApplied: (target) => { state.shown = target },
      onFailed: failed,
    })

    expect(state).toEqual({ actual: false, desired: false, shown: false })
    expect(failed).toHaveBeenCalledOnce()
  })

  it('stops after an in-flight target settles following unmount', async () => {
    const state = { actual: false, desired: true, shown: false }
    const target = createDeferred<void>()
    const applied = vi.fn()
    let active = true
    const operation = applyDesiredCardVisibility({
      getActual: () => state.actual,
      getDesired: () => state.desired,
      isActive: () => active,
      setActual: (value) => { state.actual = value },
      setDesired: (value) => { state.desired = value },
      apply: () => target.promise,
      onApplied: applied,
      onFailed: vi.fn(),
    })

    active = false
    target.resolve()
    await operation

    expect(state).toEqual({ actual: false, desired: true, shown: false })
    expect(applied).not.toHaveBeenCalled()
  })
})

describe('drag pending click settlement', () => {
  it.each([
    ['success', true, false],
    ['failure', false, false],
    ['rejection', false, true],
  ] as const)('commits once before %s terminal cleanup', async (_name, result, rejects) => {
    vi.useFakeTimers()
    try {
      const events: string[] = []
      const finish = vi.fn(() => new Promise<boolean>((resolve, reject) => {
        setTimeout(() => {
          if (rejects) reject(new Error('finish failed'))
          else resolve(result)
        }, 10)
      }))
      const operation = finishDragWithPendingClick(
        finish,
        true,
        () => events.push('commit'),
        (finished) => events.push(finished ? 'dropping' : 'clear'),
      )

      await vi.advanceTimersByTimeAsync(10)
      await operation

      expect(events).toEqual(['commit', result && !rejects ? 'dropping' : 'clear'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not commit a cancelled pending click', async () => {
    vi.useFakeTimers()
    try {
      const coordinator = createPendingClickCoordinator()
      const commit = vi.fn()
      coordinator.markDue()
      coordinator.cancel()

      await finishDragWithPendingClick(
        () => Promise.resolve(true),
        coordinator.settle('drag'),
        commit,
        vi.fn(),
      )

      expect(commit).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('completes cleanup without committing after unmount', async () => {
    vi.useFakeTimers()
    try {
      const mounted = { current: true }
      const events: string[] = []
      const operation = finishDragWithPendingClick(
        () => new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 10)),
        true,
        () => {
          if (mounted.current) events.push('commit')
        },
        () => events.push('complete'),
      )
      mounted.current = false

      await vi.advanceTimersByTimeAsync(10)
      await operation

      expect(events).toEqual(['complete'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('still completes cleanup and lets the caller contain a commit error', async () => {
    const complete = vi.fn()
    const caught = vi.fn()

    await finishDragWithPendingClick(
      () => Promise.resolve(true),
      true,
      () => { throw new Error('commit failed') },
      complete,
    ).catch(caught)

    expect(caught).toHaveBeenCalledOnce()
    expect(complete).toHaveBeenCalledWith(true)
  })
})
