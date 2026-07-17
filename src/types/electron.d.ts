export interface ElectronAPI {
  onStateUpdate: (callback: (data: StateUpdate) => void) => void
  login: () => Promise<boolean>
  logout: () => Promise<void>
  openExternal: (url: string) => Promise<void>
  checkin: () => Promise<void>
}

export interface StateUpdate {
  wallet: {
    balance: number
    daily_token_balance: number
    daily_token_limit: number
  } | null
  tasks: Array<{
    id: string
    title: string
    status: string
    created_at: number
  }>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
