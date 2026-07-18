import { describe, expect, it } from 'vitest'
import {
  ORBIT_LAYOUT,
  initialCheckinFeedback,
  syncCheckinFeedback,
  type CheckinFeedback,
} from './OrbitStatusPanel'

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
    for (const card of [ORBIT_LAYOUT.quota, ORBIT_LAYOUT.tasks, ORBIT_LAYOUT.checkin, ORBIT_LAYOUT.actions]) {
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
