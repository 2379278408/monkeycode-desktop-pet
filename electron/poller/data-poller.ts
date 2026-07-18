import { ApiError } from '../api/client'
import type {
  CheckinStatus,
  ProjectTask,
  TaskList,
  TaskTerminalEvent,
  Wallet,
} from '../api/types'

interface PollingApi {
  request<T>(path: string, init?: RequestInit): Promise<T>
}

export interface PollerState {
  wallet: Wallet | null
  tasks: ProjectTask[]
  checked_in: boolean | null
  task_event: TaskTerminalEvent | null
  online: boolean
  error: string | null
}

export interface DataPollerOptions {
  taskIntervalMs?: number
  walletIntervalMs?: number
}

interface RefreshSelection {
  tasks?: boolean
  wallet?: boolean
  checkin?: boolean
}

interface RefreshQueue {
  generation: number
  pending: RefreshSelection
  promise: Promise<void>
  resolve: () => void
}

interface PendingTerminalTask {
  task: ProjectTask
  attempts: number
  nextRetryAt: number
  createdAt: number
  expiresAt: number
}

type Settled<T> = { value: T; error?: never } | { value?: never; error: unknown }

const ACTIVE_TASK_PATH = '/api/v1/users/tasks?status=processing,pending'
const MAX_TRACKED_TASKS = 3
const MAX_PENDING_TERMINAL_TASKS = 12
const MAX_TERMINAL_ATTEMPTS = 5
const TERMINAL_TASK_TTL_MS = 10 * 60_000

function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  return promise.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  )
}

function localDate(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '数据更新失败'
}

export class DataPoller {
  private intervalId: ReturnType<typeof setInterval> | null = null
  private readonly updateCallbacks = new Set<(state: PollerState) => void>()
  private readonly authExpiredCallbacks = new Set<() => void>()
  private readonly api: PollingApi
  private readonly taskIntervalMs: number
  private readonly walletIntervalMs: number
  private generation = 0
  private refreshQueue: RefreshQueue | null = null
  private hasTaskBaseline = false
  private activeTasks = new Map<string, ProjectTask>()
  private pendingTerminalTasks = new Map<string, PendingTerminalTask>()
  private checkinCacheGeneration: number | null = null
  private checkinCacheDate: string | null = null
  private checkinMutationVersion = 0
  private checkedInMutationGeneration: number | null = null
  private checkedInMutationDate: string | null = null
  private lastWalletRefreshAt: number | null = null
  private state: PollerState = {
    wallet: null,
    tasks: [],
    checked_in: null,
    task_event: null,
    online: true,
    error: null,
  }

  constructor(api: PollingApi, options: DataPollerOptions = {}) {
    this.api = api
    this.taskIntervalMs = options.taskIntervalMs ?? 15_000
    this.walletIntervalMs = options.walletIntervalMs ?? 300_000
  }

  onUpdate(callback: (state: PollerState) => void): () => void {
    this.updateCallbacks.add(callback)
    return () => this.updateCallbacks.delete(callback)
  }

  onAuthExpired(callback: () => void): () => void {
    this.authExpiredCallbacks.add(callback)
    return () => this.authExpiredCallbacks.delete(callback)
  }

  start(): void {
    if (this.intervalId) return
    this.generation += 1
    this.clearGenerationCaches()
    void this.refreshAll()
    this.intervalId = setInterval(() => void this.refreshScheduled(), this.taskIntervalMs)
  }

  stop(): void {
    this.generation += 1
    this.clearGenerationCaches()
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  reset(): void {
    this.stop()
    this.state = {
      wallet: null,
      tasks: [],
      checked_in: null,
      task_event: null,
      online: true,
      error: null,
    }
    this.publish()
  }

  isActive(): boolean {
    return this.intervalId !== null
  }

  refresh(): Promise<void> {
    return this.refreshAll()
  }

  refreshTasks(): Promise<void> {
    return this.runRefresh({ tasks: true })
  }

  refreshAll(): Promise<void> {
    return this.runRefresh({ tasks: true, wallet: true, checkin: true })
  }

  captureGeneration(): number {
    return this.generation
  }

  async markCheckedIn(expectedGeneration: number): Promise<boolean> {
    if (expectedGeneration !== this.generation) return false
    this.checkinMutationVersion += 1
    this.checkinCacheGeneration = this.generation
    this.checkinCacheDate = localDate()
    this.checkedInMutationGeneration = this.generation
    this.checkedInMutationDate = this.checkinCacheDate
    this.state = { ...this.state, checked_in: true, task_event: null }
    this.publish()
    await this.runRefresh({ wallet: true })
    return true
  }

  private refreshScheduled(): Promise<void> {
    const now = Date.now()
    const walletDue = this.lastWalletRefreshAt === null
      || now - this.lastWalletRefreshAt >= this.walletIntervalMs
    const date = localDate()
    const checkinDue = this.checkinCacheGeneration !== this.generation
      || this.checkinCacheDate !== date
    return this.runRefresh({ tasks: true, wallet: walletDue, checkin: checkinDue })
  }

  private runRefresh(selection: RefreshSelection): Promise<void> {
    const generation = this.generation
    if (this.refreshQueue?.generation === generation) {
      this.mergeSelection(this.refreshQueue.pending, selection)
      return this.refreshQueue.promise
    }

    let resolveQueue = (): void => undefined
    const queue: RefreshQueue = {
      generation,
      pending: { ...selection },
      promise: new Promise((resolve) => {
        resolveQueue = resolve
      }),
      resolve: () => resolveQueue(),
    }
    this.refreshQueue = queue
    void this.drainRefreshQueue(queue)
    return queue.promise
  }

  private async drainRefreshQueue(queue: RefreshQueue): Promise<void> {
    try {
      while (queue.generation === this.generation && this.hasSelection(queue.pending)) {
        const selection = queue.pending
        queue.pending = {}
        await this.executeRefresh(selection, queue.generation)
      }
    } finally {
      if (this.refreshQueue === queue) this.refreshQueue = null
      queue.resolve()
    }
  }

  private async executeRefresh(selection: RefreshSelection, generation: number): Promise<void> {
    const checkinVersion = this.checkinMutationVersion
    const checkinRequestDate = selection.checkin ? localDate() : null

    try {
      const [walletResult, checkinResult, taskListResult] = await Promise.all([
        selection.wallet
          ? settle(this.api.request<Wallet>('/api/v1/users/wallet'))
          : Promise.resolve(null),
        selection.checkin
          ? settle(this.api.request<CheckinStatus>('/api/v1/users/wallet/checkin'))
          : Promise.resolve(null),
        selection.tasks
          ? settle(this.api.request<TaskList>(ACTIVE_TASK_PATH))
          : Promise.resolve(null),
      ])
      if (generation !== this.generation) return

      const checkinResponseDate = selection.checkin ? localDate() : null
      if (checkinRequestDate !== null && checkinRequestDate !== checkinResponseDate) {
        if (this.refreshQueue?.generation === generation) {
          this.mergeSelection(this.refreshQueue.pending, { checkin: true })
        }
      }

      const initialErrors: unknown[] = []
      for (const result of [walletResult, checkinResult, taskListResult]) {
        if (result && 'error' in result) initialErrors.push(result.error)
      }
      if (this.expireAuthIfNeeded(initialErrors)) return

      let wallet = walletResult?.value ?? this.state.wallet
      let tasks = this.state.tasks
      let checkedIn = this.state.checked_in
      let taskEvents: TaskTerminalEvent[] = []
      const errors = [...initialErrors]

      if (walletResult?.value !== undefined) this.lastWalletRefreshAt = Date.now()
      if (checkinResult?.value !== undefined
        && checkinRequestDate === checkinResponseDate
        && checkinVersion === this.checkinMutationVersion) {
        this.checkinCacheGeneration = generation
        this.checkinCacheDate = checkinRequestDate
        const hasCurrentCheckedInMutation = this.checkedInMutationGeneration === generation
          && this.checkedInMutationDate === this.checkinCacheDate
        if (!hasCurrentCheckedInMutation || checkinResult.value.checked_in !== false) {
          checkedIn = checkinResult.value.checked_in ?? null
        }
      }

      if (taskListResult?.value !== undefined) {
        const taskResult = await this.processTaskList(taskListResult.value, generation)
        if (generation !== this.generation) return
        if (this.expireAuthIfNeeded(taskResult.errors)) return
        tasks = taskResult.tasks
        taskEvents = taskResult.events
        errors.push(...taskResult.errors)
      }

      if (taskEvents.length > 0) {
        const terminalWalletResult = await settle(this.api.request<Wallet>('/api/v1/users/wallet'))
        if (generation !== this.generation) return
        if ('error' in terminalWalletResult) {
          if (this.expireAuthIfNeeded([terminalWalletResult.error])) return
          errors.push(terminalWalletResult.error)
        } else {
          wallet = terminalWalletResult.value
          this.lastWalletRefreshAt = Date.now()
        }
      }

      const firstError = errors[0]
      this.state = {
        wallet,
        tasks,
        checked_in: checkedIn,
        task_event: null,
        online: !errors.some((error) => error instanceof ApiError && error.httpStatus === 0),
        error: firstError === undefined ? null : errorMessage(firstError),
      }
      if (taskEvents.length === 0) {
        this.publish()
      } else {
        for (const taskEvent of taskEvents) this.publish(taskEvent)
      }
    } catch (error) {
      if (generation !== this.generation) return
      if (this.expireAuthIfNeeded([error])) return
      this.state = {
        ...this.state,
        task_event: null,
        online: !(error instanceof ApiError && error.httpStatus === 0),
        error: errorMessage(error),
      }
      this.publish()
    }
  }

  private mergeSelection(target: RefreshSelection, selection: RefreshSelection): void {
    target.tasks ||= selection.tasks
    target.wallet ||= selection.wallet
    target.checkin ||= selection.checkin
  }

  private hasSelection(selection: RefreshSelection): boolean {
    return Boolean(selection.tasks || selection.wallet || selection.checkin)
  }

  private async processTaskList(
    taskList: TaskList,
    generation: number,
  ): Promise<{ tasks: ProjectTask[]; events: TaskTerminalEvent[]; errors: unknown[] }> {
    const tasks = (taskList.tasks ?? []).slice(0, MAX_TRACKED_TASKS)
    const currentActiveTasks = new Map(tasks.map((task) => [task.id, task]))
    if (!this.hasTaskBaseline) {
      this.hasTaskBaseline = true
      this.activeTasks = currentActiveTasks
      this.pendingTerminalTasks.clear()
      return { tasks, events: [], errors: [] }
    }

    const now = Date.now()
    const pendingTasks = new Map(this.pendingTerminalTasks)
    this.prunePendingTasks(pendingTasks, now)
    for (const task of this.activeTasks.values()) {
      if (!currentActiveTasks.has(task.id) && !pendingTasks.has(task.id)) {
        pendingTasks.set(task.id, {
          task,
          attempts: 0,
          nextRetryAt: now,
          createdAt: now,
          expiresAt: now + TERMINAL_TASK_TTL_MS,
        })
      }
    }
    for (const taskId of currentActiveTasks.keys()) pendingTasks.delete(taskId)
    this.limitPendingTasks(pendingTasks)

    const duePendingTasks = [...pendingTasks.values()]
      .filter((pending) => pending.nextRetryAt <= now)
      .slice(0, MAX_TRACKED_TASKS)
    const detailResults = await Promise.all(duePendingTasks.map(async (pending) => ({
      pending,
      result: await settle(this.api.request<ProjectTask>(
        `/api/v1/users/tasks/${encodeURIComponent(pending.task.id)}`,
      )),
    })))
    if (generation !== this.generation) return { tasks, events: [], errors: [] }

    const resultTime = Date.now()
    const events: TaskTerminalEvent[] = []
    const errors: unknown[] = []
    for (const { pending, result } of detailResults) {
      const { task } = pending
      if (resultTime >= pending.expiresAt) {
        if ('error' in result) errors.push(result.error)
        pendingTasks.delete(task.id)
        continue
      }
      if ('error' in result) {
        errors.push(result.error)
        this.schedulePendingRetry(pendingTasks, pending, task, resultTime)
        continue
      }
      if (result.value.status === 'finished' || result.value.status === 'error') {
        pendingTasks.delete(task.id)
        events.push({
          task_id: task.id,
          title: result.value.title ?? task.title,
          status: result.value.status,
          occurred_at: Date.now(),
        })
      } else {
        this.schedulePendingRetry(pendingTasks, pending, { ...task, ...result.value }, resultTime)
      }
    }

    this.activeTasks = currentActiveTasks
    this.pendingTerminalTasks = pendingTasks
    return { tasks, events, errors }
  }

  private schedulePendingRetry(
    pendingTasks: Map<string, PendingTerminalTask>,
    pending: PendingTerminalTask,
    task: ProjectTask,
    now: number,
  ): void {
    const attempts = pending.attempts + 1
    if (attempts >= MAX_TERMINAL_ATTEMPTS || now >= pending.expiresAt) {
      pendingTasks.delete(task.id)
      return
    }
    pendingTasks.set(task.id, {
      ...pending,
      task,
      attempts,
      nextRetryAt: now + this.taskIntervalMs * (2 ** (attempts - 1)),
    })
  }

  private prunePendingTasks(
    pendingTasks: Map<string, PendingTerminalTask>,
    now: number,
  ): void {
    for (const [taskId, pending] of pendingTasks) {
      if (pending.attempts >= MAX_TERMINAL_ATTEMPTS || now >= pending.expiresAt) {
        pendingTasks.delete(taskId)
      }
    }
  }

  private limitPendingTasks(pendingTasks: Map<string, PendingTerminalTask>): void {
    if (pendingTasks.size <= MAX_PENDING_TERMINAL_TASKS) return
    const oldest = [...pendingTasks.entries()]
      .sort(([, left], [, right]) => left.createdAt - right.createdAt)
    for (const [taskId] of oldest.slice(0, pendingTasks.size - MAX_PENDING_TERMINAL_TASKS)) {
      pendingTasks.delete(taskId)
    }
  }

  private expireAuthIfNeeded(errors: unknown[]): boolean {
    if (!errors.some((error) => error instanceof ApiError && error.isAuthError)) return false
    this.stop()
    for (const callback of this.authExpiredCallbacks) {
      try {
        callback()
      } catch {
        // Isolate subscribers without exposing authentication details.
      }
    }
    return true
  }

  private clearGenerationCaches(): void {
    this.hasTaskBaseline = false
    this.activeTasks.clear()
    this.pendingTerminalTasks.clear()
    this.checkinCacheGeneration = null
    this.checkinCacheDate = null
    this.checkinMutationVersion += 1
    this.checkedInMutationGeneration = null
    this.checkedInMutationDate = null
    this.lastWalletRefreshAt = null
  }

  private publish(taskEvent: TaskTerminalEvent | null = null): void {
    for (const callback of this.updateCallbacks) {
      const snapshot: PollerState = {
        ...this.state,
        task_event: taskEvent ? { ...taskEvent } : null,
        tasks: this.state.tasks.map((task) => ({ ...task })),
        wallet: this.state.wallet ? { ...this.state.wallet } : null,
      }
      try {
        callback(snapshot)
      } catch {
        // Isolate subscribers without exposing state contents.
      }
    }
  }
}
