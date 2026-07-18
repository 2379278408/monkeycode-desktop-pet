import { ApiError } from '../api/client'
import type { ProjectTask, TaskList, Wallet } from '../api/types'

interface PollingApi {
  request<T>(path: string, init?: RequestInit): Promise<T>
}

export interface PollerState {
  wallet: Wallet | null
  tasks: ProjectTask[]
  online: boolean
  error: string | null
}

export class DataPoller {
  private intervalId: ReturnType<typeof setInterval> | null = null
  private readonly updateCallbacks = new Set<(state: PollerState) => void>()
  private readonly authExpiredCallbacks = new Set<() => void>()
  private readonly api: PollingApi
  private readonly intervalMs: number
  private generation = 0
  private inFlightGeneration: number | null = null
  private state: PollerState = {
    wallet: null,
    tasks: [],
    online: true,
    error: null,
  }

  constructor(api: PollingApi, intervalMs = 30_000) {
    this.api = api
    this.intervalMs = intervalMs
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
    void this.refresh()
    this.intervalId = setInterval(() => void this.refresh(), this.intervalMs)
  }

  stop(): void {
    this.generation += 1
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
      online: true,
      error: null,
    }
    this.publish()
  }

  isActive(): boolean {
    return this.intervalId !== null
  }

  async refresh(): Promise<void> {
    const generation = this.generation
    if (this.inFlightGeneration === generation) return
    this.inFlightGeneration = generation

    try {
      const [wallet, taskList] = await Promise.all([
        this.api.request<Wallet>('/api/v1/users/wallet'),
        this.api.request<TaskList>('/api/v1/users/tasks?status=processing,pending'),
      ])
      if (generation !== this.generation) return
      this.state = {
        wallet,
        tasks: taskList.tasks ?? [],
        online: true,
        error: null,
      }
      this.publish()
    } catch (error) {
      if (generation !== this.generation) return
      if (error instanceof ApiError && error.isAuthError) {
        this.stop()
        for (const callback of this.authExpiredCallbacks) callback()
        return
      }

      this.state = {
        ...this.state,
        online: !(error instanceof ApiError && error.httpStatus === 0),
        error: error instanceof Error ? error.message : '数据更新失败',
      }
      this.publish()
    } finally {
      if (this.inFlightGeneration === generation) {
        this.inFlightGeneration = null
      }
    }
  }

  private publish(): void {
    const snapshot: PollerState = {
      ...this.state,
      tasks: [...this.state.tasks],
      wallet: this.state.wallet ? { ...this.state.wallet } : null,
    }
    for (const callback of this.updateCallbacks) callback(snapshot)
  }
}
