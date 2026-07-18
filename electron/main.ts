import { app, BrowserWindow, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ApiClient } from './api/client'
import type { Wallet } from './api/types'
import { CaptchaClient } from './auth/captcha-client'
import { AuthManager } from './auth/manager'
import { DataPoller } from './poller/data-poller'
import { TrayManager } from './tray/manager'

const PET_WIDTH = 380
const PET_HEIGHT = 430
const MIN_WINDOW_SIZE = 200
const MAX_WINDOW_SIZE = 800

let petWindow: BrowserWindow | null = null
let authManager: AuthManager
let dataApi: ApiClient
let captchaClient: CaptchaClient
let dataPoller: DataPoller | null = null
let trayManager: TrayManager

function isTrustedRendererUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    if (process.env.VITE_DEV_SERVER_URL) {
      return url.origin === new URL(process.env.VITE_DEV_SERVER_URL).origin
    }
    const productionUrl = new URL(pathToFileURL(path.join(__dirname, '../dist/index.html')).toString())
    return url.protocol === 'file:' && url.pathname === productionUrl.pathname
  } catch {
    return false
  }
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (!petWindow || petWindow.isDestroyed()
    || event.sender !== petWindow.webContents
    || !event.senderFrame
    || !isTrustedRendererUrl(event.senderFrame.url)) {
    throw new Error('禁止的 IPC 来源')
  }
}

function createPetWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: PET_WIDTH,
    height: PET_HEIGHT,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    void win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
  win.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault()
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.on('closed', () => { petWindow = null })
  return win
}

function ensureDataPoller(): DataPoller {
  if (dataPoller) return dataPoller

  dataPoller = new DataPoller(dataApi)
  dataPoller.onUpdate((state) => {
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('state-update', state)
    }

    const balance = state.wallet?.daily_token_balance ?? 0
    const limit = state.wallet?.daily_token_limit ?? 0
    const percent = limit > 0 ? Math.round((balance / limit) * 100) : 0
    trayManager?.updateTooltip(
      `MonkeyCode Pet\nQuota: ${percent}%\nTasks: ${state.tasks.length}`,
    )
  })
  dataPoller.onAuthExpired(() => {
    dataPoller?.reset()
    try {
      authManager.clearSession()
    } catch (error) {
      console.warn('[Auth] 清理失效会话失败',
        error instanceof Error ? error.message : 'unknown error')
    } finally {
      if (petWindow && !petWindow.isDestroyed()) {
        petWindow.webContents.send('auth-expired')
      }
    }
  })
  return dataPoller
}

function assertWindowSize(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height)
    || width < MIN_WINDOW_SIZE || height < MIN_WINDOW_SIZE
    || width > MAX_WINDOW_SIZE || height > MAX_WINDOW_SIZE) {
    throw new Error('无效窗口尺寸')
  }
}

function assertExternalUrl(rawUrl: string): URL {
  const url = new URL(rawUrl)
  if (url.protocol !== 'https:'
    || (url.hostname !== 'monkeycode-ai.com'
      && !url.hostname.endsWith('.monkeycode-ai.com'))) {
    throw new Error('禁止打开该链接')
  }
  return url
}

function registerIPC(): void {
  captchaClient = new CaptchaClient()
  authManager = new AuthManager({ captcha: captchaClient })
  dataApi = new ApiClient({ getSession: () => authManager.getSession() })

  ipcMain.handle('auth:check-session', async (event) => {
    assertTrustedSender(event)
    const hadSession = !!authManager.getSession()
    if (!hadSession) return { logged_in: false }

    const valid = await authManager.validateSession()
    if (valid) return { logged_in: true }
    if (authManager.getSession()) {
      return { logged_in: false, offline: true, error: '网络连接失败，请稍后重试' }
    }
    return { logged_in: false }
  })

  ipcMain.handle('auth:login', (event, email: unknown, password: unknown) => {
    assertTrustedSender(event)
    if (typeof email !== 'string' || typeof password !== 'string') {
      throw new Error('无效登录参数')
    }
    return authManager.loginWithCredentials(email, password)
  })

  ipcMain.handle('auth:logout', async (event) => {
    assertTrustedSender(event)
    try {
      await authManager.logout()
    } finally {
      dataPoller?.reset()
    }
  })

  ipcMain.handle('data:start', (event) => {
    assertTrustedSender(event)
    ensureDataPoller().start()
  })

  ipcMain.handle('data:refresh', (event) => {
    assertTrustedSender(event)
    return ensureDataPoller().refresh()
  })

  ipcMain.handle('wallet:checkin', async (event) => {
    assertTrustedSender(event)
    try {
      const session = authManager.getSession()
      if (!session) throw new Error('登录状态已失效，请重新登录')
      const captchaToken = await captchaClient.obtainToken()
      if (authManager.getSession() !== session) {
        throw new Error('登录状态已变更，请重新签到')
      }
      await dataApi.request<Wallet>('/api/v1/users/wallet/checkin', {
        method: 'POST',
        body: JSON.stringify({ captcha_token: captchaToken }),
      })
      await ensureDataPoller().refresh()
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '签到失败，请重试',
      }
    }
  })

  ipcMain.handle('open-external', async (_event, rawUrl: string) => {
    assertTrustedSender(_event)
    if (typeof rawUrl !== 'string') throw new Error('无效链接')
    const url = assertExternalUrl(rawUrl)
    await shell.openExternal(url.toString())
  })

  ipcMain.handle('window:resize', (_event, width: number, height: number) => {
    assertTrustedSender(_event)
    assertWindowSize(width, height)
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.setSize(width, height)
    }
  })
}

async function main(): Promise<void> {
  registerIPC()
  petWindow = createPetWindow()
  trayManager = new TrayManager(petWindow)
  trayManager.create()
}

app.whenReady().then(main)

app.on('before-quit', () => dataPoller?.stop())

app.on('activate', () => {
  if (!petWindow) petWindow = createPetWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
