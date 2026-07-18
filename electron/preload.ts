import { contextBridge, ipcRenderer } from 'electron'
import type { PollerState } from './poller/data-poller'
import type { PetLifeSnapshot } from './pet-life/store'

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
  loadPetLife: (): Promise<PetLifeSnapshot | null> =>
    ipcRenderer.invoke('pet-life:load'),
  savePetLife: (snapshot: PetLifeSnapshot): Promise<void> =>
    ipcRenderer.invoke('pet-life:save', snapshot),
  beginDrag: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke('window:drag-begin', sessionId),
  moveDrag: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke('window:drag-move', sessionId),
  endDrag: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke('window:drag-end', sessionId),
  cancelDrag: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke('window:drag-cancel', sessionId),
  setMousePassthrough: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('window:set-mouse-passthrough', enabled),
  setWindowMode: (mode: 'auth' | 'collapsed' | 'expanded'): Promise<void> =>
    ipcRenderer.invoke('window:set-mode', mode),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  checkin: () => ipcRenderer.invoke('wallet:checkin'),
})
