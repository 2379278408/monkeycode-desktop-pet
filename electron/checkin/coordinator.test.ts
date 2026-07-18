import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { CheckinCoordinator } from './coordinator'

describe('CheckinCoordinator', () => {
  let generation: number
  let checkedIn: boolean
  let session: string | null
  let date: string
  let now: number
  let markCheckedIn: Mock<(expectedGeneration: number, expectedDate: string) => Promise<boolean>>
  let obtainCaptchaToken: Mock<() => Promise<string>>
  let submitCheckin: Mock<(captchaToken: string) => Promise<void>>
  let coordinator: CheckinCoordinator

  beforeEach(() => {
    generation = 1
    checkedIn = false
    session = 'session-a'
    date = '2026-07-18'
    now = 20_000
    markCheckedIn = vi.fn(async (expectedGeneration: number, expectedDate: string) => {
      if (expectedGeneration !== generation || expectedDate !== date) return false
      checkedIn = true
      return true
    })
    obtainCaptchaToken = vi.fn(async () => 'captcha-token')
    submitCheckin = vi.fn(async (_captchaToken: string) => {})
    coordinator = new CheckinCoordinator({
      getPoller: () => ({
        captureGeneration: () => generation,
        captureCheckinDate: () => date,
        isCheckedIn: () => checkedIn,
        markCheckedIn,
      }),
      getSession: () => session,
      obtainCaptchaToken,
      submitCheckin,
      now: () => now,
    })
  })

  it('returns the cached checked-in result without requesting captcha', async () => {
    checkedIn = true

    await expect(coordinator.checkin()).resolves.toEqual({
      success: true,
      already_checked_in: true,
      message: '今日已签到',
    })
    expect(obtainCaptchaToken).not.toHaveBeenCalled()
    expect(submitCheckin).not.toHaveBeenCalled()
  })

  it('shares one operation within the same login generation', async () => {
    let resolveCaptcha: ((token: string) => void) | undefined
    obtainCaptchaToken.mockImplementation(() => new Promise((resolve) => {
      resolveCaptcha = resolve
    }))

    const first = coordinator.checkin()
    const second = coordinator.checkin()
    expect(second).toBe(first)
    resolveCaptcha?.('captcha-token')

    await expect(first).resolves.toEqual({ success: true, message: '签到成功' })
    expect(submitCheckin).toHaveBeenCalledTimes(1)
  })

  it('shares the active operation after checked-in state is published', async () => {
    let resolveMark: ((applied: boolean) => void) | undefined
    markCheckedIn.mockImplementation(() => {
      checkedIn = true
      return new Promise((resolve) => {
        resolveMark = resolve
      })
    })

    const first = coordinator.checkin()
    await vi.waitFor(() => expect(markCheckedIn).toHaveBeenCalledTimes(1))
    const second = coordinator.checkin()
    expect(second).toBe(first)

    generation = 2
    resolveMark?.(false)
    await expect(first).resolves.toEqual(expect.objectContaining({ success: false }))
    await expect(second).resolves.toEqual(expect.objectContaining({ success: false }))
  })

  it('isolates active operations and cooldowns across login generations', async () => {
    let resolveFirstCaptcha: ((token: string) => void) | undefined
    obtainCaptchaToken.mockImplementationOnce(() => new Promise((resolve) => {
      resolveFirstCaptcha = resolve
    }))
    const first = coordinator.checkin()

    generation = 2
    session = 'session-b'
    const second = coordinator.checkin()
    await expect(second).resolves.toEqual({ success: true, message: '签到成功' })

    generation = 1
    session = 'session-a'
    checkedIn = false
    resolveFirstCaptcha?.('captcha-token')
    await first

    generation = 2
    session = 'session-b'
    checkedIn = false
    await expect(coordinator.checkin()).resolves.toEqual(expect.objectContaining({
      success: false,
      message: '操作过于频繁，请稍后重试',
    }))
    expect(submitCheckin).toHaveBeenCalledTimes(2)
  })

  it('rejects a session change before submitting the captcha token', async () => {
    obtainCaptchaToken.mockImplementation(async () => {
      session = 'session-b'
      generation = 2
      return 'captcha-token'
    })

    await expect(coordinator.checkin()).resolves.toEqual(expect.objectContaining({
      success: false,
      message: '登录状态已变更，请重新签到',
    }))
    expect(submitCheckin).not.toHaveBeenCalled()
  })

  it('rejects a generation change while applying the checked-in state', async () => {
    markCheckedIn.mockImplementation(async () => {
      generation = 2
      return false
    })

    await expect(coordinator.checkin()).resolves.toEqual(expect.objectContaining({
      success: false,
      message: '登录状态已变更，请重新签到',
    }))
  })

  it('rejects a date change before submitting the captcha token', async () => {
    obtainCaptchaToken.mockImplementation(async () => {
      date = '2026-07-19'
      return 'captcha-token'
    })

    await expect(coordinator.checkin()).resolves.toEqual(expect.objectContaining({
      success: false,
      message: '日期已变更，请重新签到',
    }))
    expect(submitCheckin).not.toHaveBeenCalled()
  })

  it('rejects a date change after submitting the captcha token', async () => {
    submitCheckin.mockImplementation(async () => {
      date = '2026-07-19'
    })

    await expect(coordinator.checkin()).resolves.toEqual(expect.objectContaining({
      success: false,
      message: '日期已变更，请重新签到',
    }))
    expect(markCheckedIn).not.toHaveBeenCalled()
  })

  it('does not apply the previous date cooldown to the new date', async () => {
    await expect(coordinator.checkin()).resolves.toEqual({ success: true, message: '签到成功' })
    checkedIn = false
    date = '2026-07-19'

    await expect(coordinator.checkin()).resolves.toEqual({ success: true, message: '签到成功' })
    expect(submitCheckin).toHaveBeenCalledTimes(2)
  })

  it('applies cooldown only after an operation completes', async () => {
    await expect(coordinator.checkin()).resolves.toEqual({ success: true, message: '签到成功' })
    checkedIn = false

    await expect(coordinator.checkin()).resolves.toEqual(expect.objectContaining({
      success: false,
      message: '操作过于频繁，请稍后重试',
    }))

    now += 10_000
    await expect(coordinator.checkin()).resolves.toEqual({ success: true, message: '签到成功' })
  })
})
