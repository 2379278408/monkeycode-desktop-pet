import { app, BrowserWindow, ipcMain, shell, nativeImage } from 'electron'
import path from 'path'
import { AuthManager } from './auth/manager'
import { DataPoller } from './poller/data-poller'
import { TrayManager } from './tray/manager'

let petWindow: BrowserWindow | null = null
let authManager: AuthManager
let dataPoller: DataPoller
let trayManager: TrayManager

function createPetWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 200,
    height: 200,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Make click-through on transparent areas
  win.setIgnoreMouseEvents(false)

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile('dist/index.html')
  }

  return win
}

async function main() {
  authManager = new AuthManager()

  // Check session
  const hasSession = await authManager.validateSession()
  if (!hasSession) {
    const loggedIn = await authManager.login()
    if (!loggedIn) {
      app.quit()
      return
    }
  }

  // Create pet window
  petWindow = createPetWindow()

  // Create tray
  trayManager = new TrayManager(petWindow)
  trayManager.create()

  // Start data polling
  dataPoller = new DataPoller(() => authManager.getSession())
  dataPoller.onUpdate((state) => {
    petWindow?.webContents.send('state-update', state)

    // Update tray tooltip
    if (state.wallet) {
      const percent = Math.round(
        (state.wallet.daily_token_balance / state.wallet.daily_token_limit) * 100
      )
      trayManager.updateTooltip(
        `MonkeyCode Pet\nQuota: ${percent}%\nTasks: ${state.tasks.length}`
      )
    }
  })
  dataPoller.start()

  // IPC handlers
  ipcMain.handle('auth:login', () => authManager.login())
  ipcMain.handle('auth:logout', () => {
    authManager.logout()
    dataPoller.stop()
  })
  ipcMain.handle('open-external', (_event, url: string) => shell.openExternal(url))
  ipcMain.handle('wallet:checkin', () => shell.openExternal('https://monkeycode.ai/console/wallet'))
}

app.whenReady().then(main)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
