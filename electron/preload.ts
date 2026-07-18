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
  resizeWindow: (width: number, height: number) =>
    ipcRenderer.invoke('window:resize', width, height),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  checkin: () => ipcRenderer.invoke('wallet:checkin'),
})
