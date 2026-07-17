import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DataPoller } from './data-poller'

describe('DataPoller', () => {
  let poller: DataPoller
  const mockGetSession = vi.fn().mockReturnValue('test-session')

  beforeEach(() => {
    vi.useFakeTimers()
    poller = new DataPoller(mockGetSession)
  })

  afterEach(() => {
    poller.stop()
    vi.useRealTimers()
  })

  it('should fetch wallet data', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        code: 0,
        data: { balance: 100, daily_token_balance: 200, daily_token_limit: 300 },
      }),
    })

    const callback = vi.fn()
    poller.onUpdate(callback)
    poller.start()

    await vi.advanceTimersByTimeAsync(30000)
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        wallet: expect.objectContaining({ balance: 100 }),
      })
    )
  })

  it('should stop polling when stop() is called', () => {
    poller.start()
    poller.stop()
    expect(poller.isActive()).toBe(false)
  })
})
