import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  onStateUpdate: (callback: (data: any) => void) =>
    ipcRenderer.on('state-update', (_event, data) => callback(data)),
})
