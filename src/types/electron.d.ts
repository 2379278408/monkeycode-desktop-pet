export interface TaskData {
  id: string
  title?: string
  status?: string
  created_at?: number
}

export interface WalletData {
  balance?: number
  daily_token_balance?: number
  daily_token_limit?: number
}

export interface TaskTerminalEvent {
  task_id: string
  title?: string
  status: 'finished' | 'error'
  occurred_at: number
}

export interface StateUpdate {
  wallet: WalletData | null
  tasks: TaskData[]
  checked_in: boolean | null
  task_event: TaskTerminalEvent | null
  online: boolean
  error: string | null
}

export interface ElectronAPI {
  checkSession: () => Promise<{
    logged_in: boolean
    offline?: boolean
    error?: string
  }>
  login: (email: string, password: string) => Promise<{
    success: boolean
    error?: string
  }>
  logout: () => Promise<void>
  startPolling: () => Promise<void>
  refresh: () => Promise<void>
  onStateUpdate: (callback: (data: StateUpdate) => void) => () => void
  onAuthExpired: (callback: () => void) => () => void
  resizeWindow: (width: number, height: number) => Promise<void>
  openExternal: (url: string) => Promise<void>
  checkin: () => Promise<{ success: boolean; error?: string }>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
