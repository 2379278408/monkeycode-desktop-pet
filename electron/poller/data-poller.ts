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

type Settled<T> = { value: T; error?: never } | { value?: never; error: unknown }

const ACTIVE_TASK_PATH = '/api/v1/users/tasks?status=processing,pending'
const MAX_TRACKED_TASKS = 3

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
  private inFlightGeneration: number | null = null
  private hasTaskBaseline = false
  private trackedActiveTasks = new Map<string, ProjectTask>()
  private checkinCacheGeneration: number | null = null
  private checkinCacheDate: string | null = null
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

  async markCheckedIn(): Promise<void> {
    this.checkinCacheGeneration = this.generation
    this.checkinCacheDate = localDate()
    this.state = { ...this.state, checked_in: true, task_event: null }
    this.publish()
    await this.runRefresh({ wallet: true })
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

  private async runRefresh(selection: RefreshSelection): Promise<void> {
    const generation = this.generation
    if (this.inFlightGeneration === generation) return
    this.inFlightGeneration = generation

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

      const initialErrors: unknown[] = []
      for (const result of [walletResult, checkinResult, taskListResult]) {
        if (result && 'error' in result) initialErrors.push(result.error)
      }
      if (this.expireAuthIfNeeded(initialErrors)) return

      let wallet = walletResult?.value ?? this.state.wallet
      let tasks = this.state.tasks
      let checkedIn = checkinResult?.value?.checked_in ?? this.state.checked_in
      let taskEvents: TaskTerminalEvent[] = []
      const errors = [...initialErrors]

      if (walletResult?.value !== undefined) this.lastWalletRefreshAt = Date.now()
      if (checkinResult?.value !== undefined) {
        this.checkinCacheGeneration = generation
        this.checkinCacheDate = localDate()
      }

      if (taskListResult?.value !== undefined) {
        const taskResult = await this.processTaskList(taskListResult.value, generation)
        if (generation !== this.generation) return
        if (this.expireAuthIfNeeded(taskResult.errors)) return
        tasks = taskResult.tasks
        taskEvents = taskResult.events
        errors.push(...taskResult.errors)
      }

      if (taskEvents.length > 0 && !selection.wallet) {
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
    } finally {
      if (this.inFlightGeneration === generation) this.inFlightGeneration = null
    }
  }

  private async processTaskList(
    taskList: TaskList,
    generation: number,
  ): Promise<{ tasks: ProjectTask[]; events: TaskTerminalEvent[]; errors: unknown[] }> {
    const tasks = (taskList.tasks ?? []).slice(0, MAX_TRACKED_TASKS)
    if (!this.hasTaskBaseline) {
      this.hasTaskBaseline = true
      this.trackedActiveTasks = new Map(tasks.map((task) => [task.id, task]))
      return { tasks, events: [], errors: [] }
    }

    const activeIds = new Set(tasks.map((task) => task.id))
    const missingTasks = [...this.trackedActiveTasks.values()]
      .filter((task) => !activeIds.has(task.id))
    const detailResults = await Promise.all(missingTasks.map(async (task) => ({
      task,
      result: await settle(this.api.request<ProjectTask>(
        `/api/v1/users/tasks/${encodeURIComponent(task.id)}`,
      )),
    })))
    if (generation !== this.generation) return { tasks, events: [], errors: [] }

    const events: TaskTerminalEvent[] = []
    const errors: unknown[] = []
    const retainedTasks: ProjectTask[] = []
    for (const { task, result } of detailResults) {
      if ('error' in result) {
        errors.push(result.error)
        retainedTasks.push(task)
        continue
      }
      if (result.value.status === 'finished' || result.value.status === 'error') {
        events.push({
          task_id: task.id,
          title: result.value.title ?? task.title,
          status: result.value.status,
          occurred_at: Date.now(),
        })
      } else {
        retainedTasks.push({ ...task, ...result.value })
      }
    }

    const trackedTasks = new Map<string, ProjectTask>()
    for (const task of retainedTasks) {
      if (trackedTasks.size >= MAX_TRACKED_TASKS) break
      trackedTasks.set(task.id, task)
    }
    for (const task of tasks) {
      if (trackedTasks.size >= MAX_TRACKED_TASKS) break
      trackedTasks.set(task.id, task)
    }
    this.trackedActiveTasks = trackedTasks
    return { tasks, events, errors }
  }

  private expireAuthIfNeeded(errors: unknown[]): boolean {
    if (!errors.some((error) => error instanceof ApiError && error.isAuthError)) return false
    this.stop()
    for (const callback of this.authExpiredCallbacks) callback()
    return true
  }

  private clearGenerationCaches(): void {
    this.hasTaskBaseline = false
    this.trackedActiveTasks.clear()
    this.checkinCacheGeneration = null
    this.checkinCacheDate = null
    this.lastWalletRefreshAt = null
  }

  private publish(taskEvent: TaskTerminalEvent | null = null): void {
    const snapshot: PollerState = {
      ...this.state,
      task_event: taskEvent,
      tasks: [...this.state.tasks],
      wallet: this.state.wallet ? { ...this.state.wallet } : null,
    }
    for (const callback of this.updateCallbacks) callback(snapshot)
  }
}
