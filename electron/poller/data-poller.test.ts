import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { DataPoller } from './data-poller'

describe('DataPoller', () => {
  const api = { request: vi.fn() }
  let poller: DataPoller

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    api.request.mockImplementation((path: string) => Promise.resolve(
      path.includes('/wallet')
        ? { balance: 100, daily_token_balance: 200, daily_token_limit: 300 }
        : { tasks: [{ id: 't1', title: 'Task', status: 'processing' }] },
    ))
    poller = new DataPoller(api, 30_000)
  })

  afterEach(() => {
    poller.stop()
    vi.useRealTimers()
  })

  it('publishes wallet and tasks immediately', async () => {
    const callback = vi.fn()
    poller.onUpdate(callback)

    await poller.refresh()

    expect(callback).toHaveBeenCalledWith(expect.objectContaining({
      wallet: expect.objectContaining({ balance: 100 }),
      tasks: [expect.objectContaining({ id: 't1' })],
      online: true,
      error: null,
    }))
  })

  it('starts only one interval and can restart after stop', () => {
    poller.start()
    poller.start()
    expect(vi.getTimerCount()).toBe(1)

    poller.stop()
    poller.start()
    expect(poller.isActive()).toBe(true)
    expect(vi.getTimerCount()).toBe(1)
  })

  it('suppresses overlapping refreshes', async () => {
    const resolvers: Array<(value: unknown) => void> = []
    api.request.mockImplementation(() => new Promise((resolve) => {
      resolvers.push(resolve)
    }))

    const first = poller.refresh()
    const second = poller.refresh()
    expect(api.request).toHaveBeenCalledTimes(2)
    resolvers[0]({})
    resolvers[1]({ tasks: [] })
    await Promise.all([first, second])
    expect(api.request).toHaveBeenCalledTimes(2)
  })

  it('preserves data and reports offline network state', async () => {
    const callback = vi.fn()
    poller.onUpdate(callback)
    await poller.refresh()
    api.request.mockRejectedValue(new ApiError('网络连接失败，请检查网络后重试', 0))

    await poller.refresh()

    expect(callback).toHaveBeenLastCalledWith(expect.objectContaining({
      wallet: expect.objectContaining({ balance: 100 }),
      online: false,
      error: '网络连接失败，请检查网络后重试',
    }))
  })

  it('stops and publishes auth expiry on unauthorized response', async () => {
    const expired = vi.fn()
    poller.onAuthExpired(expired)
    api.request.mockRejectedValue(new ApiError('未登录', 401, 401))
    poller.start()

    await poller.refresh()
    await vi.runAllTicks()

    expect(expired).toHaveBeenCalledOnce()
    expect(poller.isActive()).toBe(false)
  })

  it('ignores a stale unauthorized response after stop and restart', async () => {
    const expired = vi.fn()
    const resolvers: Array<{
      resolve: (value: unknown) => void
      reject: (error: unknown) => void
    }> = []
    api.request.mockImplementation(() => new Promise((resolve, reject) => {
      resolvers.push({ resolve, reject })
    }))
    poller.onAuthExpired(expired)
    poller.start()
    poller.stop()
    poller.start()

    resolvers[0].reject(new ApiError('未登录', 401, 401))
    resolvers[1].reject(new ApiError('未登录', 401, 401))
    await vi.runAllTicks()

    expect(expired).not.toHaveBeenCalled()
    expect(poller.isActive()).toBe(true)

    resolvers[2].resolve({ balance: 1 })
    resolvers[3].resolve({ tasks: [] })
    await vi.runAllTicks()
  })

  it('clears account data when reset', async () => {
    const updates: unknown[] = []
    poller.onUpdate((state) => updates.push(state))
    poller.start()
    await vi.runAllTicks()

    poller.reset()

    expect(updates[updates.length - 1]).toEqual({
      wallet: null,
      tasks: [],
      online: true,
      error: null,
    })
    expect(poller.isActive()).toBe(false)
  })
})
