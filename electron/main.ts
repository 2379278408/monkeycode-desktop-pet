import { app, BrowserWindow, ipcMain, shell } from 'electron'
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
    width: 320,
    height: 400,
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

  win.setIgnoreMouseEvents(false)

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile('dist/index.html')
  }

  return win
}

function startDataPolling() {
  if (dataPoller) return // 避免重复启动

  dataPoller = new DataPoller(() => authManager.getSession())
  dataPoller.onUpdate((state) => {
    petWindow?.webContents.send('state-update', state)

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
}

// 在 app.whenReady 之前注册 IPC handlers
function registerIPC() {
  authManager = new AuthManager()

  // 检查登录状态
  ipcMain.handle('auth:check-session', async () => {
    try {
      const session = authManager.getSession()
      if (!session) return { logged_in: false }

      const valid = await authManager.validateSession()
      if (valid) {
        startDataPolling()
        return { logged_in: true }
      }
      return { logged_in: false }
    } catch (err: any) {
      console.error('[Auth] check-session error:', err)
      return { logged_in: false }
    }
  })

  // 登录（账密方式）
  ipcMain.handle('auth:login', async (_event, email: string, password: string) => {
    try {
      const result = await authManager.loginWithCredentials(email, password)
      if (result.success) {
        startDataPolling()
        return { success: true }
      }
      return { success: false, error: result.error }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // 登出
  ipcMain.handle('auth:logout', () => {
    authManager.logout()
    dataPoller?.stop()
  })

  // 打开外部链接
  ipcMain.handle('open-external', (_event, url: string) => shell.openExternal(url))

  // 签到
  ipcMain.handle('wallet:checkin', () => shell.openExternal('https://monkeycode-ai.com/console/wallet'))

  // 调整窗口大小
  ipcMain.handle('window:resize', (_event, width: number, height: number) => {
    if (petWindow) {
      petWindow.setSize(width, height)
      petWindow.center()
    }
  })
}

async function main() {
  // 先注册 IPC
  registerIPC()

  // 再创建窗口
  petWindow = createPetWindow()

  // 创建托盘
  trayManager = new TrayManager(petWindow)
  trayManager.create()
}

app.whenReady().then(main)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
