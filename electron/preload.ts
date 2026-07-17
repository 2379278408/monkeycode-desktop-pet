import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // Auth
  checkSession: () => ipcRenderer.invoke('auth:check-session'),
  login: (email: string, password: string) =>
    ipcRenderer.invoke('auth:login', email, password),
  logout: () => ipcRenderer.invoke('auth:logout'),

  // State
  onStateUpdate: (callback: (data: any) => void) =>
    ipcRenderer.on('state-update', (_event, data) => callback(data)),

  // Window
  resizeWindow: (width: number, height: number) =>
    ipcRenderer.invoke('window:resize', width, height),

  // Actions
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  checkin: () => ipcRenderer.invoke('wallet:checkin'),
})
