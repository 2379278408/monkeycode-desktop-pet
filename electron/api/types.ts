export interface ApiEnvelope<T> {
  code: number
  message?: string
  data: T
}

export interface UserStatus {
  user?: {
    id?: string
    email?: string
    name?: string
  }
  teams?: unknown[]
}

export interface Wallet {
  balance?: number
  daily_token_balance?: number
  daily_token_limit?: number
}

export interface ProjectTask {
  id: string
  title?: string
  status?: string
  created_at?: number
}

export interface TaskList {
  tasks?: ProjectTask[]
}
