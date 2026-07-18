import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import type { PollerState } from './data-poller'
import { DataPoller } from './data-poller'

const wallet = { balance: 100, daily_token_balance: 200, daily_token_limit: 300 }

describe('DataPoller', () => {
  const api = { request: vi.fn() }
  let poller: DataPoller

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 18, 12))
    vi.clearAllMocks()
    api.request.mockImplementation((path: string) => {
      if (path === '/api/v1/users/wallet') return Promise.resolve(wallet)
      if (path === '/api/v1/users/wallet/checkin') return Promise.resolve({ checked_in: false })
      if (path === '/api/v1/users/tasks?status=processing,pending') {
        return Promise.resolve({ tasks: [{ id: 't1', title: 'Task', status: 'processing' }] })
      }
      throw new Error(`Unexpected path: ${path}`)
    })
    poller = new DataPoller(api, { taskIntervalMs: 15_000, walletIntervalMs: 300_000 })
  })

  afterEach(() => {
    poller.stop()
    vi.useRealTimers()
  })

  it('publishes wallet, tasks, and checkin status immediately', async () => {
    const callback = vi.fn()
    poller.onUpdate(callback)

    await poller.refreshAll()

    expect(callback).toHaveBeenCalledWith(expect.objectContaining({
      wallet: expect.objectContaining({ balance: 100 }),
      tasks: [expect.objectContaining({ id: 't1' })],
      checked_in: false,
      task_event: null,
      online: true,
      error: null,
    }))
  })

  it('isolates update callbacks and gives each callback a deep snapshot', async () => {
    let activeRequestCount = 0
    api.request.mockImplementation((path: string) => {
      if (path === '/api/v1/users/wallet') return Promise.resolve(wallet)
      if (path === '/api/v1/users/wallet/checkin') return Promise.resolve({ checked_in: false })
      if (path === '/api/v1/users/tasks?status=processing,pending') {
        activeRequestCount += 1
        return Promise.resolve(activeRequestCount === 1
          ? { tasks: [{ id: 't1', title: 'Task', status: 'processing' }] }
          : { tasks: [] })
      }
      if (path === '/api/v1/users/tasks/t1') {
        return Promise.resolve({ id: 't1', title: 'Task', status: 'finished' })
      }
      throw new Error(`Unexpected path: ${path}`)
    })
    const updates: PollerState[] = []
    poller.onUpdate((state) => {
      if (state.wallet) state.wallet.balance = -1
      if (state.tasks[0]) state.tasks[0].title = 'mutated task'
      if (state.task_event) state.task_event.title = 'mutated event'
      throw new Error('subscriber failed')
    })
    poller.onUpdate((state) => updates.push(state))

    await poller.refreshAll()
    await poller.refreshTasks()

    expect(updates[0].wallet?.balance).toBe(100)
    expect(updates[0].tasks[0].title).toBe('Task')
    expect(updates[1].task_event?.title).toBe('Task')
  })

  it('isolates auth expiry callbacks', async () => {
    const notified = vi.fn()
    poller.onAuthExpired(() => {
      throw new Error('subscriber failed')
    })
    poller.onAuthExpired(notified)
    api.request.mockImplementation((path: string) => {
      if (path === '/api/v1/users/wallet'
        || path === '/api/v1/users/wallet/checkin'
        || path === '/api/v1/users/tasks?status=processing,pending') {
        return Promise.reject(new ApiError('未登录', 401, 401))
      }
      throw new Error(`Unexpected path: ${path}`)
    })

    await poller.refreshAll()

    expect(notified).toHaveBeenCalledOnce()
  })

  it('uses the first active task response only as a baseline', async () => {
    const updates: PollerState[] = []
    poller.onUpdate((state) => updates.push(state))

    await poller.refreshTasks()

    expect(updates).toHaveLength(1)
    expect(updates[0].task_event).toBeNull()
    expect(api.request).toHaveBeenCalledTimes(1)
  })

  it('confirms a missing active task and emits finished once', async () => {
    let activeRequestCount = 0
    api.request.mockImplementation((path: string) => {
      if (path === '/api/v1/users/wallet') return Promise.resolve(wallet)
      if (path === '/api/v1/users/wallet/checkin') return Promise.resolve({ checked_in: false })
      if (path.includes('status=processing,pending')) {
        activeRequestCount += 1
        return Promise.resolve(activeRequestCount === 1
          ? { tasks: [{ id: 't1', title: 'Task t1', status: 'processing' }] }
          : { tasks: [] })
      }
      if (path === '/api/v1/users/tasks/t1') {
        return Promise.resolve({ id: 't1', title: 'Task t1', status: 'finished' })
      }
      throw new Error(`Unexpected path: ${path}`)
    })
    const updates: PollerState[] = []
    poller.onUpdate((state) => updates.push(state))

    await poller.refreshAll()
    await poller.refreshTasks()
    await poller.refreshTasks()

    expect(updates.flatMap((state) => state.task_event ? [state.task_event] : []))
      .toEqual([{ task_id: 't1', title: 'Task t1', status: 'finished', occurred_at: expect.any(Number) }])
    expect(api.request).toHaveBeenCalledWith('/api/v1/users/tasks/t1')
    expect(api.request.mock.calls.filter(([path]) => path === '/api/v1/users/wallet')).toHaveLength(2)
  })

  it('emits an error terminal event', async () => {
    let activeRequestCount = 0
    api.request.mockImplementation((path: string) => {
      if (path === '/api/v1/users/wallet') return Promise.resolve(wallet)
      if (path.includes('status=processing,pending')) {
        activeRequestCount += 1
        return Promise.resolve(activeRequestCount === 1
          ? { tasks: [{ id: 't1', title: 'Original title', status: 'pending' }] }
          : { tasks: [] })
      }
      if (path === '/api/v1/users/tasks/t1') {
        return Promise.resolve({ id: 't1', title: 'Failed task', status: 'error' })
      }
      throw new Error(`Unexpected path: ${path}`)
    })
    const updates: PollerState[] = []
    poller.onUpdate((state) => updates.push(state))

    await poller.refreshTasks()
    await poller.refreshTasks()
    await poller.refreshTasks()

    expect(updates.flatMap((state) => state.task_event ? [state.task_event] : []))
      .toEqual([{ task_id: 't1', title: 'Failed task', status: 'error', occurred_at: expect.any(Number) }])
  })

  it('refreshes wallet again after a terminal event in refreshAll', async () => {
    let activeRequestCount = 0
    api.request.mockImplementation((path: string) => {
      if (path === '/api/v1/users/wallet') return Promise.resolve(wallet)
      if (path === '/api/v1/users/wallet/checkin') return Promise.resolve({ checked_in: false })
      if (path.includes('status=processing,pending')) {
        activeRequestCount += 1
        return Promise.resolve(activeRequestCount === 1
          ? { tasks: [{ id: 't1', status: 'processing' }] }
          : { tasks: [] })
      }
      if (path === '/api/v1/users/tasks/t1') {
        return Promise.resolve({ id: 't1', status: 'finished' })
      }
      throw new Error(`Unexpected path: ${path}`)
    })

    await poller.refreshAll()
    await poller.refreshAll()

    expect(api.request.mock.calls.filter(([path]) => path === '/api/v1/users/wallet')).toHaveLength(3)
  })

  it('retries terminal confirmation after a detail request fails', async () => {
    let activeRequestCount = 0
    let detailRequestCount = 0
    api.request.mockImplementation((path: string) => {
      if (path.includes('status=processing,pending')) {
        activeRequestCount += 1
        return Promise.resolve(activeRequestCount === 1
          ? { tasks: [{ id: 'task/a b', title: 'Encoded', status: 'processing' }] }
          : { tasks: [] })
      }
      if (path === '/api/v1/users/tasks/task%2Fa%20b') {
        detailRequestCount += 1
        return detailRequestCount === 1
          ? Promise.reject(new Error('detail unavailable'))
          : Promise.resolve({ id: 'task/a b', title: 'Encoded', status: 'finished' })
      }
      if (path === '/api/v1/users/wallet') return Promise.resolve(wallet)
      throw new Error(`Unexpected path: ${path}`)
    })
    const updates: PollerState[] = []
    poller.onUpdate((state) => updates.push(state))

    await poller.refreshTasks()
    await poller.refreshTasks()
    expect(updates.some((state) => state.task_event)).toBe(false)

    await vi.advanceTimersByTimeAsync(15_000)
    await poller.refreshTasks()
    expect(detailRequestCount).toBe(2)
    expect(updates.flatMap((state) => state.task_event ? [state.task_event.status] : [])).toEqual(['finished'])
  })

  it('retains a missing task while its detail is still active', async () => {
    let activeRequestCount = 0
    let detailRequestCount = 0
    api.request.mockImplementation((path: string) => {
      if (path.includes('status=processing,pending')) {
        activeRequestCount += 1
        return Promise.resolve(activeRequestCount === 1
          ? { tasks: [{ id: 't1', status: 'processing' }] }
          : { tasks: [] })
      }
      if (path === '/api/v1/users/tasks/t1') {
        detailRequestCount += 1
        return Promise.resolve({ id: 't1', status: detailRequestCount === 1 ? 'processing' : 'finished' })
      }
      if (path === '/api/v1/users/wallet') return Promise.resolve(wallet)
      throw new Error(`Unexpected path: ${path}`)
    })
    const updates: PollerState[] = []
    poller.onUpdate((state) => updates.push(state))

    await poller.refreshTasks()
    await poller.refreshTasks()
    await vi.advanceTimersByTimeAsync(15_000)
    await poller.refreshTasks()

    expect(detailRequestCount).toBe(2)
    expect(updates.flatMap((state) => state.task_event ? [state.task_event.status] : [])).toEqual(['finished'])
  })

  it('tracks at most three active tasks', async () => {
    let activeRequestCount = 0
    api.request.mockImplementation((path: string) => {
      if (path.includes('status=processing,pending')) {
        activeRequestCount += 1
        return Promise.resolve(activeRequestCount === 1
          ? { tasks: Array.from({ length: 5 }, (_, index) => ({ id: `t${index + 1}`, status: 'processing' })) }
          : { tasks: [] })
      }
      if (path.startsWith('/api/v1/users/tasks/')) {
        return Promise.resolve({ id: path.split('/').slice(-1)[0], status: 'finished' })
      }
      if (path === '/api/v1/users/wallet') return Promise.resolve(wallet)
      throw new Error(`Unexpected path: ${path}`)
    })

    await poller.refreshTasks()
    await poller.refreshTasks()

    const detailPaths = api.request.mock.calls
      .map(([path]) => path as string)
      .filter((path) => path.startsWith('/api/v1/users/tasks/'))
    expect(detailPaths).toEqual([
      '/api/v1/users/tasks/t1',
      '/api/v1/users/tasks/t2',
      '/api/v1/users/tasks/t3',
    ])
  })

  it('tracks three new active tasks while older terminal confirmations retry', async () => {
    let activeRequestCount = 0
    const oldIds = ['old1', 'old2', 'old3']
    const newIds = ['new1', 'new2', 'new3']
    api.request.mockImplementation((path: string) => {
      if (path === '/api/v1/users/tasks?status=processing,pending') {
        activeRequestCount += 1
        if (activeRequestCount === 1) {
          return Promise.resolve({ tasks: oldIds.map((id) => ({ id, status: 'processing' })) })
        }
        if (activeRequestCount === 2) {
          return Promise.resolve({ tasks: newIds.map((id) => ({ id, status: 'processing' })) })
        }
        return Promise.resolve({ tasks: [] })
      }
      if (oldIds.some((id) => path === `/api/v1/users/tasks/${id}`)) {
        return Promise.reject(new Error('detail unavailable'))
      }
      const newId = newIds.find((id) => path === `/api/v1/users/tasks/${id}`)
      if (newId) return Promise.resolve({ id: newId, status: 'finished' })
      if (path === '/api/v1/users/wallet') return Promise.resolve(wallet)
      throw new Error(`Unexpected path: ${path}`)
    })
    const updates: PollerState[] = []
    poller.onUpdate((state) => updates.push(state))

    await poller.refreshTasks()
    await poller.refreshTasks()
    await poller.refreshTasks()

    expect(updates[1].tasks.map((task) => task.id)).toEqual(newIds)
    expect(updates.flatMap((state) => state.task_event ? [state.task_event.task_id] : []))
      .toEqual(newIds)
    for (const id of newIds) {
      expect(api.request).toHaveBeenCalledWith(`/api/v1/users/tasks/${id}`)
    }
  })

  it('bounds pending confirmations while active tasks continuously rotate', async () => {
    const batches = Array.from({ length: 6 }, (_, batchIndex) =>
      Array.from({ length: 3 }, (_, taskIndex) => `batch${batchIndex}-task${taskIndex}`))
    let activeRequestCount = 0
    const detailCounts = new Map<string, number>()
    api.request.mockImplementation((path: string) => {
      if (path === '/api/v1/users/tasks?status=processing,pending') {
        const batch = batches[Math.min(activeRequestCount, batches.length - 1)]
        activeRequestCount += 1
        return Promise.resolve({ tasks: batch.map((id) => ({ id, status: 'processing' })) })
      }
      if (path.startsWith('/api/v1/users/tasks/')) {
        const taskId = decodeURIComponent(path.slice('/api/v1/users/tasks/'.length))
        detailCounts.set(taskId, (detailCounts.get(taskId) ?? 0) + 1)
        return Promise.reject(new Error('detail unavailable'))
      }
      throw new Error(`Unexpected path: ${path}`)
    })
    const detailRequestCount = (): number => [...detailCounts.values()]
      .reduce((total, count) => total + count, 0)

    await poller.refreshTasks()
    for (let round = 1; round < batches.length; round += 1) {
      const before = detailRequestCount()
      await poller.refreshTasks()
      expect(detailRequestCount() - before).toBeLessThanOrEqual(3)
    }

    await vi.advanceTimersByTimeAsync(15_000)
    for (let round = 0; round < 4; round += 1) {
      const before = detailRequestCount()
      await poller.refreshTasks()
      expect(detailRequestCount() - before).toBeLessThanOrEqual(3)
    }

    for (const taskId of batches[0]) expect(detailCounts.get(taskId)).toBe(1)
    for (const batch of batches.slice(1, 5)) {
      for (const taskId of batch) expect(detailCounts.get(taskId)).toBe(2)
    }
  })

  it('backs off failed confirmations and stops after five attempts', async () => {
    let activeRequestCount = 0
    let detailRequestCount = 0
    api.request.mockImplementation((path: string) => {
      if (path === '/api/v1/users/tasks?status=processing,pending') {
        activeRequestCount += 1
        return Promise.resolve(activeRequestCount === 1
          ? { tasks: [{ id: 't1', status: 'processing' }] }
          : { tasks: [] })
      }
      if (path === '/api/v1/users/tasks/t1') {
        detailRequestCount += 1
        return Promise.reject(new Error('detail unavailable'))
      }
      throw new Error(`Unexpected path: ${path}`)
    })

    await poller.refreshTasks()
    await poller.refreshTasks()
    await poller.refreshTasks()
    expect(detailRequestCount).toBe(1)

    await vi.advanceTimersByTimeAsync(14_999)
    await poller.refreshTasks()
    expect(detailRequestCount).toBe(1)

    await vi.advanceTimersByTimeAsync(1)
    await poller.refreshTasks()
    for (const delay of [30_000, 60_000, 120_000]) {
      await vi.advanceTimersByTimeAsync(delay)
      await poller.refreshTasks()
    }
    expect(detailRequestCount).toBe(5)

    await vi.advanceTimersByTimeAsync(240_000)
    await poller.refreshTasks()
    expect(detailRequestCount).toBe(5)
  })

  it('expires pending confirmations after ten minutes', async () => {
    poller.stop()
    poller = new DataPoller(api, { taskIntervalMs: 300_000, walletIntervalMs: 300_000 })
    let activeRequestCount = 0
    let detailRequestCount = 0
    api.request.mockImplementation((path: string) => {
      if (path === '/api/v1/users/tasks?status=processing,pending') {
        activeRequestCount += 1
        return Promise.resolve(activeRequestCount === 1
          ? { tasks: [{ id: 't1', status: 'processing' }] }
          : { tasks: [] })
      }
      if (path === '/api/v1/users/tasks/t1') {
        detailRequestCount += 1
        return Promise.reject(new Error('detail unavailable'))
      }
      throw new Error(`Unexpected path: ${path}`)
    })

    await poller.refreshTasks()
    await poller.refreshTasks()
    await vi.advanceTimersByTimeAsync(300_000)
    await poller.refreshTasks()
    await vi.advanceTimersByTimeAsync(300_000)
    await poller.refreshTasks()

    expect(detailRequestCount).toBe(2)
  })

  it('refreshes tasks every 15 seconds and wallet every five minutes', async () => {
    poller.start()
    await vi.runAllTicks()

    await vi.advanceTimersByTimeAsync(15_000)
    expect(api.request.mock.calls.filter(([path]) => path === '/api/v1/users/wallet')).toHaveLength(1)
    expect(api.request.mock.calls.filter(([path]) => String(path).includes('status=processing,pending'))).toHaveLength(2)
    expect(api.request.mock.calls.filter(([path]) => path === '/api/v1/users/wallet/checkin')).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(285_000)
    expect(api.request.mock.calls.filter(([path]) => path === '/api/v1/users/wallet')).toHaveLength(2)
  })

  it('caches checkin status for the local day and refreshes after midnight', async () => {
    vi.setSystemTime(new Date(2026, 6, 18, 23, 59, 40))
    poller.start()
    await vi.runAllTicks()

    await vi.advanceTimersByTimeAsync(15_000)
    expect(api.request.mock.calls.filter(([path]) => path === '/api/v1/users/wallet/checkin')).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(15_000)
    expect(api.request.mock.calls.filter(([path]) => path === '/api/v1/users/wallet/checkin')).toHaveLength(2)
  })

  it('marks the current day checked in and refreshes wallet', async () => {
    const updates: PollerState[] = []
    poller.onUpdate((state) => updates.push(state))
    await poller.refreshAll()

    await poller.markCheckedIn(poller.captureGeneration())

    expect(updates[updates.length - 1]).toEqual(expect.objectContaining({ checked_in: true }))
    expect(api.request.mock.calls.filter(([path]) => path === '/api/v1/users/wallet')).toHaveLength(2)
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

  it('merges refreshAll into an in-flight task refresh', async () => {
    let resolveFirstTasks: ((value: unknown) => void) | undefined
    let taskRequestCount = 0
    api.request.mockImplementation((path: string) => {
      if (path.includes('status=processing,pending')) {
        taskRequestCount += 1
        if (taskRequestCount === 1) {
          return new Promise((resolve) => {
            resolveFirstTasks = resolve
          })
        }
        return Promise.resolve({ tasks: [] })
      }
      if (path === '/api/v1/users/wallet') return Promise.resolve(wallet)
      if (path === '/api/v1/users/wallet/checkin') return Promise.resolve({ checked_in: false })
      throw new Error(`Unexpected path: ${path}`)
    })

    const refreshTasks = poller.refreshTasks()
    const refreshAll = poller.refreshAll()
    resolveFirstTasks?.({ tasks: [] })
    await Promise.all([refreshTasks, refreshAll])

    expect(api.request.mock.calls.filter(([path]) => path === '/api/v1/users/wallet')).toHaveLength(1)
    expect(api.request.mock.calls.filter(([path]) => String(path).includes('status=processing,pending'))).toHaveLength(2)
    expect(api.request.mock.calls.filter(([path]) => path === '/api/v1/users/wallet/checkin')).toHaveLength(1)
  })

  it('does not let an in-flight checkin response overwrite markCheckedIn', async () => {
    let resolveCheckin: ((value: unknown) => void) | undefined
    api.request.mockImplementation((path: string) => {
      if (path === '/api/v1/users/wallet') return Promise.resolve(wallet)
      if (path === '/api/v1/users/wallet/checkin') {
        return new Promise((resolve) => {
          resolveCheckin = resolve
        })
      }
      if (path === '/api/v1/users/tasks?status=processing,pending') {
        return Promise.resolve({ tasks: [] })
      }
      throw new Error(`Unexpected path: ${path}`)
    })
    const updates: PollerState[] = []
    poller.onUpdate((state) => updates.push(state))

    const generation = poller.captureGeneration()
    const refreshAll = poller.refreshAll()
    const markCheckedIn = poller.markCheckedIn(generation)
    resolveCheckin?.({ checked_in: false })
    await Promise.all([refreshAll, markCheckedIn])

    const checkedInIndex = updates.findIndex((state) => state.checked_in === true)
    expect(checkedInIndex).toBeGreaterThanOrEqual(0)
    expect(updates.slice(checkedInIndex).every((state) => state.checked_in === true)).toBe(true)
  })

  it('ignores a previous-day checkin response and immediately queries the new day', async () => {
    vi.setSystemTime(new Date(2026, 6, 18, 23, 59, 59))
    let resolveOldCheckin: ((value: unknown) => void) | undefined
    let checkinRequestCount = 0
    api.request.mockImplementation((path: string) => {
      if (path === '/api/v1/users/wallet') return Promise.resolve(wallet)
      if (path === '/api/v1/users/wallet/checkin') {
        checkinRequestCount += 1
        if (checkinRequestCount === 1) {
          return new Promise((resolve) => {
            resolveOldCheckin = resolve
          })
        }
        return Promise.resolve({ checked_in: true })
      }
      if (path === '/api/v1/users/tasks?status=processing,pending') {
        return Promise.resolve({ tasks: [] })
      }
      throw new Error(`Unexpected path: ${path}`)
    })
    const updates: PollerState[] = []
    poller.onUpdate((state) => updates.push(state))

    const refresh = poller.refreshAll()
    vi.setSystemTime(new Date(2026, 6, 19, 0, 0, 1))
    resolveOldCheckin?.({ checked_in: false })
    await refresh

    expect(checkinRequestCount).toBe(2)
    expect(updates.every((state) => state.checked_in !== false)).toBe(true)
    expect(updates[updates.length - 1].checked_in).toBe(true)
  })

  it('rejects a checked-in result captured before reset', async () => {
    const generation = poller.captureGeneration()
    const updates: PollerState[] = []
    poller.onUpdate((state) => updates.push(state))
    let resolveCheckin: (() => void) | undefined
    const checkinRequest = new Promise<void>((resolve) => {
      resolveCheckin = resolve
    })

    poller.reset()
    resolveCheckin?.()
    await checkinRequest
    const applied = await poller.markCheckedIn(generation)

    expect(applied).toBe(false)
    expect(api.request).not.toHaveBeenCalled()
    expect(updates[updates.length - 1].checked_in).toBeNull()
  })

  it('preserves data and reports offline network state', async () => {
    const callback = vi.fn()
    poller.onUpdate(callback)
    await poller.refreshAll()
    api.request.mockImplementation((path: string) => {
      if (path === '/api/v1/users/wallet'
        || path === '/api/v1/users/wallet/checkin'
        || path === '/api/v1/users/tasks?status=processing,pending') {
        return Promise.reject(new ApiError('网络连接失败，请检查网络后重试', 0))
      }
      throw new Error(`Unexpected path: ${path}`)
    })

    await poller.refreshAll()

    expect(callback).toHaveBeenLastCalledWith(expect.objectContaining({
      wallet: expect.objectContaining({ balance: 100 }),
      online: false,
      error: '网络连接失败，请检查网络后重试',
    }))
  })

  it('stops and publishes auth expiry on unauthorized response', async () => {
    const expired = vi.fn()
    poller.onAuthExpired(expired)
    api.request.mockImplementation((path: string) => {
      if (path === '/api/v1/users/wallet'
        || path === '/api/v1/users/wallet/checkin'
        || path === '/api/v1/users/tasks?status=processing,pending') {
        return Promise.reject(new ApiError('未登录', 401, 401))
      }
      throw new Error(`Unexpected path: ${path}`)
    })
    poller.start()

    await vi.advanceTimersByTimeAsync(0)

    expect(expired).toHaveBeenCalledOnce()
    expect(poller.isActive()).toBe(false)
  })

  it('ignores stale responses after reset and establishes a new baseline', async () => {
    let resolveTasks: ((value: unknown) => void) | undefined
    api.request.mockImplementation((path: string) => {
      if (path.includes('status=processing,pending')) {
        return new Promise((resolve) => {
          resolveTasks = resolve
        })
      }
      if (path === '/api/v1/users/wallet') return Promise.resolve(wallet)
      if (path === '/api/v1/users/wallet/checkin') return Promise.resolve({ checked_in: false })
      throw new Error(`Unexpected path: ${path}`)
    })
    const updates: PollerState[] = []
    poller.onUpdate((state) => updates.push(state))
    const staleRefresh = poller.refreshTasks()

    poller.reset()
    resolveTasks?.({ tasks: [{ id: 'old', status: 'processing' }] })
    await staleRefresh

    expect(updates[updates.length - 1]).toEqual({
      wallet: null,
      tasks: [],
      checked_in: null,
      task_event: null,
      online: true,
      error: null,
    })

    api.request.mockImplementation((path: string) => {
      if (path === '/api/v1/users/tasks?status=processing,pending') return Promise.resolve({ tasks: [] })
      throw new Error(`Unexpected path: ${path}`)
    })
    await poller.refreshTasks()
    expect(api.request).not.toHaveBeenCalledWith('/api/v1/users/tasks/old')
  })

  it('discards queued refresh selections from an old generation', async () => {
    let resolveTasks: ((value: unknown) => void) | undefined
    api.request.mockImplementation((path: string) => {
      if (path.includes('status=processing,pending')) {
        return new Promise((resolve) => {
          resolveTasks = resolve
        })
      }
      if (path === '/api/v1/users/wallet') return Promise.resolve(wallet)
      if (path === '/api/v1/users/wallet/checkin') return Promise.resolve({ checked_in: false })
      throw new Error(`Unexpected path: ${path}`)
    })
    const inFlight = poller.refreshTasks()
    const queued = poller.refreshAll()

    poller.reset()
    resolveTasks?.({ tasks: [] })
    await Promise.all([inFlight, queued])

    expect(api.request.mock.calls.filter(([path]) => path === '/api/v1/users/wallet')).toHaveLength(0)
    expect(api.request.mock.calls.filter(([path]) => path === '/api/v1/users/wallet/checkin')).toHaveLength(0)
    expect(api.request.mock.calls.filter(([path]) => String(path).includes('status=processing,pending'))).toHaveLength(1)
  })

  it.each(['finished', 'error'] as const)(
    'ignores a stale %s task detail response after reset',
    async (status) => {
      let resolveDetail: ((value: unknown) => void) | undefined
      let activeRequestCount = 0
      api.request.mockImplementation((path: string) => {
        if (path.includes('status=processing,pending')) {
          activeRequestCount += 1
          return Promise.resolve(activeRequestCount === 1
            ? { tasks: [{ id: 't1', status: 'processing' }] }
            : { tasks: [] })
        }
        if (path === '/api/v1/users/tasks/t1') {
          return new Promise((resolve) => {
            resolveDetail = resolve
          })
        }
        throw new Error(`Unexpected path: ${path}`)
      })
      const expired = vi.fn()
      const updates: PollerState[] = []
      poller.onAuthExpired(expired)
      poller.onUpdate((state) => updates.push(state))
      await poller.refreshTasks()
      const staleRefresh = poller.refreshTasks()
      await vi.advanceTimersByTimeAsync(0)

      poller.reset()
      resolveDetail?.({ id: 't1', status })
      await staleRefresh

      expect(expired).not.toHaveBeenCalled()
      expect(updates.some((state) => state.task_event !== null)).toBe(false)
    },
  )

  it('queries checkin again after reset', async () => {
    await poller.refreshAll()
    poller.reset()

    await poller.refreshAll()

    expect(api.request.mock.calls.filter(([path]) => path === '/api/v1/users/wallet/checkin')).toHaveLength(2)
  })

  it('expires auth when task detail returns unauthorized', async () => {
    let activeRequestCount = 0
    api.request.mockImplementation((path: string) => {
      if (path.includes('status=processing,pending')) {
        activeRequestCount += 1
        return Promise.resolve(activeRequestCount === 1
          ? { tasks: [{ id: 't1', status: 'processing' }] }
          : { tasks: [] })
      }
      if (path === '/api/v1/users/tasks/t1') {
        return Promise.reject(new ApiError('未登录', 401, 401))
      }
      throw new Error(`Unexpected path: ${path}`)
    })
    const expired = vi.fn()
    poller.onAuthExpired(expired)

    await poller.refreshTasks()
    await poller.refreshTasks()

    expect(expired).toHaveBeenCalledOnce()
  })

  it('expires auth when the terminal wallet refresh returns unauthorized', async () => {
    let activeRequestCount = 0
    api.request.mockImplementation((path: string) => {
      if (path.includes('status=processing,pending')) {
        activeRequestCount += 1
        return Promise.resolve(activeRequestCount === 1
          ? { tasks: [{ id: 't1', status: 'processing' }] }
          : { tasks: [] })
      }
      if (path === '/api/v1/users/tasks/t1') {
        return Promise.resolve({ id: 't1', status: 'finished' })
      }
      if (path === '/api/v1/users/wallet') {
        return Promise.reject(new ApiError('未登录', 401, 401))
      }
      throw new Error(`Unexpected path: ${path}`)
    })
    const expired = vi.fn()
    poller.onAuthExpired(expired)

    await poller.refreshTasks()
    await poller.refreshTasks()

    expect(expired).toHaveBeenCalledOnce()
  })

  it('ignores a stale unauthorized response after stop and restart', async () => {
    const expired = vi.fn()
    let rejectStale: ((error: unknown) => void) | undefined
    api.request.mockImplementation((path: string) => {
      if (path.includes('status=processing,pending') && !rejectStale) {
        return new Promise((_, reject) => {
          rejectStale = reject
        })
      }
      if (path === '/api/v1/users/wallet') return Promise.resolve(wallet)
      if (path === '/api/v1/users/wallet/checkin') return Promise.resolve({ checked_in: false })
      if (path === '/api/v1/users/tasks?status=processing,pending') {
        return Promise.resolve({ tasks: [] })
      }
      throw new Error(`Unexpected path: ${path}`)
    })
    poller.onAuthExpired(expired)
    poller.start()
    poller.stop()
    poller.start()

    rejectStale?.(new ApiError('未登录', 401, 401))
    await vi.runAllTicks()

    expect(expired).not.toHaveBeenCalled()
    expect(poller.isActive()).toBe(true)
  })

  it('clears account data when reset', async () => {
    const updates: PollerState[] = []
    poller.onUpdate((state) => updates.push(state))
    poller.start()
    await vi.runAllTicks()

    poller.reset()

    expect(updates[updates.length - 1]).toEqual({
      wallet: null,
      tasks: [],
      checked_in: null,
      task_event: null,
      online: true,
      error: null,
    })
    expect(poller.isActive()).toBe(false)
  })
})
