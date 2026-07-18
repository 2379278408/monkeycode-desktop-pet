export interface CheckinResult {
  success: boolean
  already_checked_in?: boolean
  message: string
  error?: string
}

interface CheckinPoller {
  captureGeneration(): number
  captureCheckinDate(): string
  isCheckedIn(): boolean
  markCheckedIn(expectedGeneration: number, expectedDate: string): Promise<boolean>
}

interface CheckinCoordinatorOptions {
  getPoller: () => CheckinPoller
  getSession: () => string | null
  obtainCaptchaToken: () => Promise<string>
  submitCheckin: (captchaToken: string) => Promise<void>
  cooldownMs?: number
  now?: () => number
}

export class CheckinCoordinator {
  private readonly operations = new Map<string, Promise<CheckinResult>>()
  private readonly completedAt = new Map<string, number>()
  private readonly cooldownMs: number
  private readonly now: () => number

  constructor(private readonly options: CheckinCoordinatorOptions) {
    this.cooldownMs = options.cooldownMs ?? 10_000
    this.now = options.now ?? Date.now
  }

  checkin(): Promise<CheckinResult> {
    const poller = this.options.getPoller()
    const generation = poller.captureGeneration()
    const date = poller.captureCheckinDate()
    const operationKey = `${generation}:${date}`

    const activeOperation = this.operations.get(operationKey)
    if (activeOperation) return activeOperation

    if (poller.isCheckedIn()) {
      return Promise.resolve({
        success: true,
        already_checked_in: true,
        message: '今日已签到',
      })
    }

    const lastCompletedAt = this.completedAt.get(operationKey) ?? 0
    if (this.now() - lastCompletedAt < this.cooldownMs) {
      return Promise.resolve(this.failure('操作过于频繁，请稍后重试'))
    }

    const operation = this.runCheckin(poller, generation, date)
    this.operations.set(operationKey, operation)
    void operation.finally(() => {
      this.completedAt.set(operationKey, this.now())
      if (this.operations.get(operationKey) === operation) this.operations.delete(operationKey)
      this.pruneCompletedOperations(operationKey)
    })
    return operation
  }

  private async runCheckin(
    poller: CheckinPoller,
    generation: number,
    date: string,
  ): Promise<CheckinResult> {
    try {
      const session = this.options.getSession()
      if (!session) throw new Error('登录状态已失效，请重新登录')
      const captchaToken = await this.options.obtainCaptchaToken()
      if (this.options.getSession() !== session) {
        throw new Error('登录状态已变更，请重新签到')
      }
      if (poller.captureCheckinDate() !== date) throw new Error('日期已变更，请重新签到')

      await this.options.submitCheckin(captchaToken)
      if (poller.captureCheckinDate() !== date) throw new Error('日期已变更，请重新签到')
      const applied = await poller.markCheckedIn(generation, date)
      if (!applied) throw new Error('登录状态已变更，请重新签到')
      return { success: true, message: '签到成功' }
    } catch (error) {
      return this.failure(error instanceof Error ? error.message : '签到失败，请重试')
    }
  }

  private failure(message: string): CheckinResult {
    return { success: false, message, error: message }
  }

  private pruneCompletedOperations(currentOperation: string): void {
    if (this.completedAt.size <= 8) return
    for (const operationKey of this.completedAt.keys()) {
      if (operationKey !== currentOperation && !this.operations.has(operationKey)) {
        this.completedAt.delete(operationKey)
      }
      if (this.completedAt.size <= 8) break
    }
  }
}
