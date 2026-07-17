import { BrowserWindow } from 'electron'
import { SecureStore } from '../store/secure-store'

const API_BASE = 'https://monkeycode-ai.com'
const SESSION_KEY = 'monkeycode_ai_session'

export class AuthManager {
  private store: SecureStore
  private sessionCookie: string | null = null

  constructor() {
    this.store = new SecureStore('auth')
    this.sessionCookie = this.store.get(SESSION_KEY)
  }

  getSession(): string | null {
    return this.sessionCookie
  }

  async validateSession(): Promise<boolean> {
    if (!this.sessionCookie) return false

    try {
      const resp = await fetch(`${API_BASE}/api/v1/users/status`, {
        headers: { Cookie: `${SESSION_KEY}=${this.sessionCookie}` },
      })
      if (!resp.ok) {
        this.logout()
        return false
      }
      return true
    } catch {
      return false
    }
  }

  async login(): Promise<boolean> {
    return new Promise((resolve) => {
      const loginWindow = new BrowserWindow({
        width: 500,
        height: 700,
        webPreferences: { nodeIntegration: false },
      })

      loginWindow.loadURL(`${API_BASE}/login`)

      loginWindow.webContents.on('did-navigate', async (_event, url) => {
        if (url.includes('/console')) {
          const cookies = await loginWindow.webContents.session.cookies.get({
            name: SESSION_KEY,
          })
          if (cookies.length > 0) {
            this.sessionCookie = cookies[0].value
            this.store.set(SESSION_KEY, this.sessionCookie)
            loginWindow.close()
            resolve(true)
          }
        }
      })

      loginWindow.on('closed', () => resolve(false))
    })
  }

  logout(): void {
    this.sessionCookie = null
    this.store.delete(SESSION_KEY)
  }
}
