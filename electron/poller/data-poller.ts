const API_BASE = 'https://monkeycode-ai.com'

interface Wallet {
  balance: number
  daily_token_balance: number
  daily_token_limit: number
}

interface Task {
  id: string
  title: string
  status: string
  created_at: number
}

interface PollerState {
  wallet: Wallet | null
  tasks: Task[]
}

export class DataPoller {
  private intervalId: ReturnType<typeof setInterval> | null = null
  private callback: ((state: PollerState) => void) | null = null
  private getSession: () => string | null
  private state: PollerState = { wallet: null, tasks: [] }

  constructor(getSession: () => string | null) {
    this.getSession = getSession
  }

  onUpdate(callback: (state: PollerState) => void): void {
    this.callback = callback
  }

  start(): void {
    this.poll()
    this.intervalId = setInterval(() => this.poll(), 30000)
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  isActive(): boolean {
    return this.intervalId !== null
  }

  private async poll(): Promise<void> {
    const session = this.getSession()
    if (!session) return

    const headers = { Cookie: `monkeycode_ai_session=${session}` }

    try {
      const [walletResp, tasksResp] = await Promise.all([
        fetch(`${API_BASE}/api/v1/users/wallet`, { headers }),
        fetch(`${API_BASE}/api/v1/users/tasks?status=processing,pending`, { headers }),
      ])

      if (walletResp.ok) {
        const data = await walletResp.json()
        this.state.wallet = data.data
      }

      if (tasksResp.ok) {
        const data = await tasksResp.json()
        this.state.tasks = data.data?.tasks || []
      }

      this.callback?.(this.state)
    } catch {
      // Silent retry on next interval
    }
  }
}
