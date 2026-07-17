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

  async loginWithCredentials(
    email: string,
    password: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // 调用后端登录 API
      const resp = await fetch(`${API_BASE}/api/v1/users/password-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}))
        return {
          success: false,
          error: data.message || `Login failed: ${resp.status}`,
        }
      }

      // 从响应中获取 session cookie
      const setCookieHeader = resp.headers.get('set-cookie')
      if (setCookieHeader) {
        const match = setCookieHeader.match(new RegExp(`${SESSION_KEY}=([^;]+)`))
        if (match) {
          this.sessionCookie = match[1]
          this.store.set(SESSION_KEY, this.sessionCookie)
          return { success: true }
        }
      }

      // 尝试从响应体获取 token
      const data = await resp.json().catch(() => ({}))
      if (data.session || data.token) {
        this.sessionCookie = data.session || data.token
        this.store.set(SESSION_KEY, this.sessionCookie)
        return { success: true }
      }

      return { success: false, error: 'No session token in response' }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }

  logout(): void {
    this.sessionCookie = null
    this.store.delete(SESSION_KEY)
  }
}
