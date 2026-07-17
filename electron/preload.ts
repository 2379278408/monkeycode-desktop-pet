import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  onStateUpdate: (callback: (data: any) => void) =>
    ipcRenderer.on('state-update', (_event, data) => callback(data)),
  login: () => ipcRenderer.invoke('auth:login'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  checkin: () => ipcRenderer.invoke('wallet:checkin'),
})
