import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { PetLifeStoreState } from '../stores/pet-life-store'
import {
  ORBIT_LAYOUT,
  OrbitStatusPanel,
  executeLifeCommand,
  initialCheckinFeedback,
  syncCheckinFeedback,
  type CheckinFeedback,
} from './OrbitStatusPanel'

const lifeStoreHarness = vi.hoisted(() => ({
  snapshot: {
    mood: 73.8,
    satiety: 41.2,
    energy: 88.9,
    sleeping: false,
    lastCalculatedAt: 1,
    lastInteractionAt: 1,
  },
  form: 'normal',
  hydrated: true,
  persistenceError: null as string | null,
}))

vi.mock('../stores/pet-life-store', () => ({
  usePetLifeStore: (selector: (state: typeof lifeStoreHarness) => unknown) => selector(lifeStoreHarness),
}))

interface Rectangle {
  left: number
  top: number
  width: number
  height: number
}

function overlaps(first: Rectangle, second: Rectangle): boolean {
  return first.left < second.left + second.width
    && first.left + first.width > second.left
    && first.top < second.top + second.height
    && first.top + first.height > second.top
}

describe('OrbitStatusPanel state helpers', () => {
  it('disables the initial action while checkin status is unknown', () => {
    expect(initialCheckinFeedback(null)).toEqual({
      state: 'unknown',
      message: '正在获取签到状态',
    })
  })

  it('moves an external error to already checked in when fresh data arrives', () => {
    const error: CheckinFeedback = { state: 'error', message: '请求失败' }
    expect(syncCheckinFeedback(error, true)).toEqual({
      state: 'already',
      message: '今日已签到',
    })
  })

  it('restores the idle action after the local date status changes', () => {
    const success: CheckinFeedback = { state: 'success', message: '签到成功' }
    expect(syncCheckinFeedback(success, false)).toEqual({
      state: 'idle',
      message: '签到领取今日额度',
    })
  })
})

describe('OrbitStatusPanel geometry', () => {
  it('keeps every status card inside the expanded window', () => {
    for (const card of Object.values(ORBIT_LAYOUT)) {
      expect(card.left).toBeGreaterThanOrEqual(0)
      expect(card.top).toBeGreaterThanOrEqual(0)
      expect(card.left + card.width).toBeLessThanOrEqual(380)
      expect(card.top + card.height).toBeLessThanOrEqual(430)
    }
  })

  it('keeps the checkin card clear of the monkey interaction area', () => {
    expect(overlaps(ORBIT_LAYOUT.checkin, ORBIT_LAYOUT.monkey)).toBe(false)
  })

  it('keeps every orbit region separate', () => {
    const regions = Object.values(ORBIT_LAYOUT)
    for (let first = 0; first < regions.length; first += 1) {
      for (let second = first + 1; second < regions.length; second += 1) {
        expect(overlaps(regions[first], regions[second])).toBe(false)
      }
    }
  })

  it('reserves enough vertical space for checkin feedback', () => {
    expect(ORBIT_LAYOUT.checkin.height).toBeGreaterThanOrEqual(108)
  })
})

describe('OrbitStatusPanel life controls', () => {
  it('renders integer life values with accessible progress bars and controls', () => {
    const markup = renderToStaticMarkup(createElement(OrbitStatusPanel, {
      onLogout: async () => {},
      lifeAction: null,
      onLifeAction: () => {},
    }))

    expect(markup).toContain('心情')
    expect(markup).toContain('饱食度')
    expect(markup).toContain('精力')
    expect(markup).toContain('aria-label="心情 74"')
    expect(markup).toContain('aria-valuenow="74"')
    expect(markup).toContain('aria-label="饱食度 41"')
    expect(markup).toContain('aria-valuenow="41"')
    expect(markup).toContain('aria-label="精力 89"')
    expect(markup).toContain('aria-valuenow="89"')
    expect(markup.match(/role="progressbar"/g)).toHaveLength(3)
    expect(markup.match(/aria-valuemin="0"/g)).toHaveLength(3)
    expect(markup.match(/aria-valuemax="100"/g)).toHaveLength(3)
    expect(markup).toContain('>喂食</button>')
    expect(markup).toContain('>睡觉</button>')
    expect(markup).toContain('aria-label="喂食桌宠"')
    expect(markup).toContain('aria-label="让桌宠睡觉"')
    const lifeButtons = markup.match(/<button[^>]+orbit-life-button[^>]*>/g) ?? []
    expect(lifeButtons).toHaveLength(2)
    expect(lifeButtons.every((button) => !button.includes('disabled'))).toBe(true)
  })

  it('disables both controls during hydration or a life action', () => {
    lifeStoreHarness.hydrated = false
    const hydratingMarkup = renderToStaticMarkup(createElement(OrbitStatusPanel, {
      onLogout: async () => {},
      lifeAction: null,
      onLifeAction: () => {},
    }))
    expect(hydratingMarkup.match(/disabled=""/g)).toHaveLength(3)

    lifeStoreHarness.hydrated = true
    const busyMarkup = renderToStaticMarkup(createElement(OrbitStatusPanel, {
      onLogout: async () => {},
      lifeAction: 'eating',
      onLifeAction: () => {},
    }))
    expect(busyMarkup.match(/disabled=""/g)).toHaveLength(3)
  })

  it('renders wake wording and a fixed accessible persistence message', () => {
    lifeStoreHarness.snapshot.sleeping = true
    lifeStoreHarness.persistenceError = 'disk path and implementation details'

    const markup = renderToStaticMarkup(createElement(OrbitStatusPanel, {
      onLogout: async () => {},
      lifeAction: null,
      onLifeAction: () => {},
    }))

    expect(markup).toContain('>唤醒</button>')
    expect(markup).toContain('role="status"')
    expect(markup).toContain('aria-live="polite"')
    expect(markup).toContain('生命状态暂时无法保存')
    expect(markup).toContain('>未保存</span>')
    expect(markup).not.toContain('disk path and implementation details')

    lifeStoreHarness.snapshot.sleeping = false
    lifeStoreHarness.persistenceError = null
  })

  it.each([
    ['eating', 'feed'],
    ['falling-asleep', 'sleep'],
    ['waking', 'wake'],
  ] as const)('executes %s store command before its action callback', (action, command) => {
    const calls: string[] = []
    const commands = {
      feed: () => calls.push('feed'),
      sleep: () => calls.push('sleep'),
      wake: () => calls.push('wake'),
    } satisfies Pick<PetLifeStoreState, 'feed' | 'sleep' | 'wake'>

    executeLifeCommand(action, commands, (nextAction) => calls.push(nextAction))

    expect(calls).toEqual([command, action])
  })
})
