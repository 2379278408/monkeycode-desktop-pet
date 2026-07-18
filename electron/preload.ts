import { contextBridge, ipcRenderer } from 'electron'
import type { PollerState } from './poller/data-poller'

function subscribe<T>(channel: string, callback: (data: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, data: T) => callback(data)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('electronAPI', {
  checkSession: () => ipcRenderer.invoke('auth:check-session'),
  login: (email: string, password: string) =>
    ipcRenderer.invoke('auth:login', email, password),
  logout: () => ipcRenderer.invoke('auth:logout'),
  startPolling: () => ipcRenderer.invoke('data:start'),
  refresh: () => ipcRenderer.invoke('data:refresh'),
  onStateUpdate: (callback: (data: PollerState) => void) =>
    subscribe('state-update', callback),
  onAuthExpired: (callback: () => void) =>
    subscribe('auth-expired', callback),
  beginDrag: (sessionId: string, x: number, y: number): Promise<void> =>
    ipcRenderer.invoke('window:drag-begin', sessionId, x, y),
  moveDrag: (sessionId: string, x: number, y: number): Promise<void> =>
    ipcRenderer.invoke('window:drag-move', sessionId, x, y),
  endDrag: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke('window:drag-end', sessionId),
  setMousePassthrough: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('window:set-mouse-passthrough', enabled),
  setWindowMode: (mode: 'auth' | 'collapsed' | 'expanded'): Promise<void> =>
    ipcRenderer.invoke('window:set-mode', mode),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  checkin: () => ipcRenderer.invoke('wallet:checkin'),
})
