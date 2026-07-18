import { app, BrowserWindow, ipcMain, screen, shell, type IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ApiClient } from './api/client'
import type { Wallet } from './api/types'
import { CaptchaClient } from './auth/captcha-client'
import { AuthManager } from './auth/manager'
import { DataPoller } from './poller/data-poller'
import { TrayManager } from './tray/manager'
import {
  anchoredBottomCenterBounds,
  clampWindowPosition,
  isRectangleCoveredByWorkAreas,
  WINDOW_SIZES,
  type Point,
  type Rectangle,
  type WindowMode,
} from './window/interaction'

const MAX_POINTER_COORDINATE = 1_000_000
const DRAG_SESSION_TIMEOUT_MS = 60_000
const WINDOW_MOVE_THROTTLE_MS = 6
const CHECKIN_COOLDOWN_MS = 10_000

let petWindow: BrowserWindow | null = null
let authManager: AuthManager
let dataApi: ApiClient
let captchaClient: CaptchaClient
let dataPoller: DataPoller | null = null
let trayManager: TrayManager
let dragSession: {
  id: string
  pointer: Point
  bounds: Rectangle
  lastActivityAt: number
  lastWindowMoveAt: number
  pendingBounds: Rectangle | null
} | null = null
let checkinPromise: Promise<{ success: boolean; error?: string }> | null = null
let lastCheckinCompletedAt = 0

function getProductionRendererUrl(): URL {
  return new URL(pathToFileURL(path.join(__dirname, '../dist/index.html')).toString())
}

function getTrustedDevServerUrl(): URL | null {
  if (app.isPackaged || !process.env.VITE_DEV_SERVER_URL) return null

  try {
    const url = new URL(process.env.VITE_DEV_SERVER_URL)
    const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
    if ((url.protocol !== 'http:' && url.protocol !== 'https:')
      || !loopbackHosts.has(url.hostname)
      || url.username
      || url.password) {
      return null
    }
    return url
  } catch {
    return null
  }
}

function isTrustedRendererUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    const devServerUrl = getTrustedDevServerUrl()
    if (devServerUrl) {
      return !url.username
        && !url.password
        && url.origin === devServerUrl.origin
        && url.pathname === devServerUrl.pathname
    }
    const productionUrl = getProductionRendererUrl()
    return url.protocol === 'file:'
      && url.host === ''
      && url.pathname === productionUrl.pathname
      && url.search === ''
      && url.hash === ''
  } catch {
    return false
  }
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (!petWindow || petWindow.isDestroyed()) {
    throw new Error('窗口不可用')
  }
  if (event.sender !== petWindow.webContents
    || !event.senderFrame
    || event.senderFrame !== event.sender.mainFrame
    || !isTrustedRendererUrl(event.senderFrame.url)) {
    throw new Error('禁止的 IPC 来源')
  }
}

function getPetWindow(): BrowserWindow {
  if (!petWindow || petWindow.isDestroyed()) throw new Error('窗口不可用')
  return petWindow
}

function assertArgumentCount(args: unknown[], expected: number): void {
  if (args.length !== expected) throw new Error('无效窗口参数')
}

function assertPointerCoordinate(value: unknown): asserts value is number {
  if (typeof value !== 'number'
    || !Number.isFinite(value)
    || Math.abs(value) > MAX_POINTER_COORDINATE) {
    throw new Error('无效指针坐标')
  }
}

function assertDragSessionId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 64) {
    throw new Error('无效拖动会话')
  }
}

function assertWindowMode(mode: unknown): asserts mode is WindowMode {
  if (typeof mode !== 'string'
    || !Object.prototype.hasOwnProperty.call(WINDOW_SIZES, mode)) {
    throw new Error('无效窗口模式')
  }
}

function setWindowMode(mode: WindowMode): void {
  const win = getPetWindow()
  const oldBounds = win.getBounds()
  const workArea = screen.getDisplayMatching(oldBounds).workArea
  const newBounds = anchoredBottomCenterBounds(oldBounds, WINDOW_SIZES[mode], workArea)

  dragSession = null
  win.setIgnoreMouseEvents(false)
  win.setBounds(newBounds)
}

function resetWindowInteraction(win: BrowserWindow): void {
  dragSession = null
  if (!win.isDestroyed()) win.setIgnoreMouseEvents(false)
}

function applyCandidateWindowBounds(candidateBounds: Rectangle): void {
  const workAreas = screen.getAllDisplays().map((display) => display.workArea)
  const position = isRectangleCoveredByWorkAreas(candidateBounds, workAreas)
    ? { x: candidateBounds.x, y: candidateBounds.y }
    : clampWindowPosition(
        candidateBounds,
        candidateBounds,
        screen.getDisplayMatching(candidateBounds).workArea,
      )
  getPetWindow().setPosition(position.x, position.y)
}

function createPetWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: WINDOW_SIZES.auth.width,
    height: WINDOW_SIZES.auth.height,
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

  const devServerUrl = getTrustedDevServerUrl()
  if (devServerUrl) {
    void win.loadURL(devServerUrl.toString())
  } else {
    void win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
  win.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault()
  })
  win.webContents.on('will-redirect', (details) => {
    if (!isTrustedRendererUrl(details.url)) details.preventDefault()
  })
  win.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame) resetWindowInteraction(win)
  })
  win.webContents.on('render-process-gone', () => resetWindowInteraction(win))
  win.webContents.on('unresponsive', () => resetWindowInteraction(win))
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.on('closed', () => {
    dragSession = null
    petWindow = null
  })
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

  ipcMain.handle('wallet:checkin', (event) => {
    assertTrustedSender(event)
    if (checkinPromise) return checkinPromise
    if (Date.now() - lastCheckinCompletedAt < CHECKIN_COOLDOWN_MS) {
      return Promise.resolve({ success: false, error: '操作过于频繁，请稍后重试' })
    }
    const request = (async (): Promise<{ success: boolean; error?: string }> => {
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
    })()
    checkinPromise = request
    void request.finally(() => {
      lastCheckinCompletedAt = Date.now()
      if (checkinPromise === request) checkinPromise = null
    })
    return request
  })

  ipcMain.handle('open-external', async (_event, rawUrl: string) => {
    assertTrustedSender(_event)
    if (typeof rawUrl !== 'string') throw new Error('无效链接')
    const url = assertExternalUrl(rawUrl)
    await shell.openExternal(url.toString())
  })

  ipcMain.handle('window:drag-begin', (event, ...args: unknown[]) => {
    assertTrustedSender(event)
    assertArgumentCount(args, 3)
    const [sessionId, x, y] = args
    assertDragSessionId(sessionId)
    assertPointerCoordinate(x)
    assertPointerCoordinate(y)
    const now = Date.now()
    if (dragSession && now - dragSession.lastActivityAt <= DRAG_SESSION_TIMEOUT_MS) {
      throw new Error('拖动会话已存在')
    }
    dragSession = {
      id: sessionId,
      pointer: { x, y },
      bounds: getPetWindow().getBounds(),
      lastActivityAt: now,
      lastWindowMoveAt: 0,
      pendingBounds: null,
    }
  })

  ipcMain.handle('window:drag-move', (event, ...args: unknown[]) => {
    assertTrustedSender(event)
    assertArgumentCount(args, 3)
    const [sessionId, x, y] = args
    assertDragSessionId(sessionId)
    assertPointerCoordinate(x)
    assertPointerCoordinate(y)
    if (!dragSession) throw new Error('拖动会话未开始')
    if (dragSession.id !== sessionId) throw new Error('拖动会话不匹配')
    const now = Date.now()
    if (now - dragSession.lastActivityAt > DRAG_SESSION_TIMEOUT_MS) {
      dragSession = null
      throw new Error('拖动会话已过期')
    }

    const currentPointer = { x, y }
    const candidateBounds = {
      x: Math.round(dragSession.bounds.x + currentPointer.x - dragSession.pointer.x),
      y: Math.round(dragSession.bounds.y + currentPointer.y - dragSession.pointer.y),
      width: dragSession.bounds.width,
      height: dragSession.bounds.height,
    }
    if (now - dragSession.lastWindowMoveAt < WINDOW_MOVE_THROTTLE_MS) {
      dragSession.pendingBounds = candidateBounds
      dragSession.lastActivityAt = now
      return
    }
    applyCandidateWindowBounds(candidateBounds)
    dragSession.lastActivityAt = now
    dragSession.lastWindowMoveAt = now
    dragSession.pendingBounds = null
  })

  ipcMain.handle('window:drag-end', (event, ...args: unknown[]) => {
    assertTrustedSender(event)
    assertArgumentCount(args, 1)
    const [sessionId] = args
    assertDragSessionId(sessionId)
    if (!dragSession) throw new Error('拖动会话未开始')
    if (dragSession.id !== sessionId) throw new Error('拖动会话不匹配')
    if (Date.now() - dragSession.lastActivityAt > DRAG_SESSION_TIMEOUT_MS) {
      dragSession = null
      throw new Error('拖动会话已过期')
    }
    const session = dragSession
    try {
      if (session.pendingBounds) applyCandidateWindowBounds(session.pendingBounds)
    } finally {
      if (dragSession === session) dragSession = null
    }
  })

  ipcMain.handle('window:set-mouse-passthrough', (event, ...args: unknown[]) => {
    assertTrustedSender(event)
    assertArgumentCount(args, 1)
    const [enabled] = args
    if (typeof enabled !== 'boolean') throw new Error('无效鼠标穿透参数')

    const win = getPetWindow()
    if (enabled) {
      win.setIgnoreMouseEvents(true, { forward: true })
    } else {
      win.setIgnoreMouseEvents(false)
    }
  })

  ipcMain.handle('window:set-mode', (event, ...args: unknown[]) => {
    assertTrustedSender(event)
    assertArgumentCount(args, 1)
    const [mode] = args
    assertWindowMode(mode)
    setWindowMode(mode)
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
