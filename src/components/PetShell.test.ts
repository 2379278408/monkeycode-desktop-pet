import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PetState } from '../stores/pet-store'
import {
  PET_LIFE_TICK_MS,
  PetShell,
  petActionDuration,
  pettingDurationSeconds,
  startPetLifeClock,
  taskResultEventKey,
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
