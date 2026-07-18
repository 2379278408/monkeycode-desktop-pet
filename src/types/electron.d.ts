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

export type WindowMode = 'auth' | 'collapsed' | 'expanded'

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
  beginDrag: (sessionId: string) => Promise<void>
  moveDrag: (sessionId: string) => Promise<void>
  endDrag: (sessionId: string) => Promise<void>
  cancelDrag: (sessionId: string) => Promise<void>
  setMousePassthrough: (enabled: boolean) => Promise<void>
  setWindowMode: (mode: WindowMode) => Promise<void>
  openExternal: (url: string) => Promise<void>
  checkin: () => Promise<{
    success: boolean
    already_checked_in?: boolean
    message: string
    error?: string
  }>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
