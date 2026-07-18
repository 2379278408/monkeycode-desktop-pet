import { ApiClient, ApiError, type ApiResponse } from '../api/client'
import type { UserStatus } from '../api/types'
import { SecureStore } from '../store/secure-store'
import { CaptchaClient } from './captcha-client'

const SESSION_KEY = 'monkeycode_ai_session'
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface SessionStore {
  get(key: string): string | null
  set(key: string, value: string): void
  delete(key: string): void
}

interface CaptchaProvider {
  obtainToken(): Promise<string>
}

interface ApiTransport {
  request<T>(path: string, init?: RequestInit): Promise<T>
  requestWithMeta<T>(path: string, init?: RequestInit): Promise<ApiResponse<T>>
}

export interface AuthManagerOptions {
  store?: SessionStore
  captcha?: CaptchaProvider
  api?: ApiTransport
}

export interface AuthResult {
  success: boolean
  error?: string
}

export class AuthManager {
  private readonly store: SessionStore
  private readonly captcha: CaptchaProvider
  private readonly api: ApiTransport
  private sessionCookie: string | null
  private loginInFlight = false
  private logoutInFlight = false
  private operationEpoch = 0

  constructor(options: AuthManagerOptions = {}) {
    this.store = options.store ?? new SecureStore('auth')
    this.captcha = options.captcha ?? new CaptchaClient()
    this.sessionCookie = this.store.get(SESSION_KEY)
    this.api = options.api ?? new ApiClient({ getSession: () => this.sessionCookie })
  }

  getSession(): string | null {
    return this.sessionCookie
  }

  async validateSession(): Promise<boolean> {
    const session = this.sessionCookie
    const operation = this.operationEpoch
    if (!session) return false

    try {
      await this.api.request<UserStatus>('/api/v1/users/status')
      return operation === this.operationEpoch && this.sessionCookie === session
    } catch (error) {
      if (error instanceof ApiError && error.isAuthError
        && operation === this.operationEpoch && this.sessionCookie === session) {
        this.clearLocalSession()
      }
      return false
    }
  }

  async loginWithCredentials(email: string, password: string): Promise<AuthResult> {
    const normalizedEmail = email.trim()
    const validationError = this.validateCredentials(normalizedEmail, password)
    if (validationError) return { success: false, error: validationError }
    if (this.logoutInFlight) return { success: false, error: '退出登录正在进行，请稍候' }
    if (this.loginInFlight) return { success: false, error: '登录正在进行，请稍候' }

    const operation = ++this.operationEpoch
    this.loginInFlight = true
    try {
      const captchaToken = await this.captcha.obtainToken()
      this.assertCurrentOperation(operation)
      const response = await this.api.requestWithMeta<unknown>(
        '/api/v1/users/password-login',
        {
          method: 'POST',
          body: JSON.stringify({
            email: normalizedEmail,
            password,
            captcha_token: captchaToken,
          }),
        },
      )
      this.assertCurrentOperation(operation)
      const session = this.extractSession(response.getSetCookies())
      if (!session) {
        return { success: false, error: '登录响应缺少会话信息，请重试' }
      }

      this.store.set(SESSION_KEY, session)
      this.sessionCookie = session

      try {
        await this.api.request<UserStatus>('/api/v1/users/status')
        this.assertCurrentOperation(operation)
      } catch (error) {
        if (operation === this.operationEpoch && this.sessionCookie === session) {
          this.clearLocalSession()
        }
        throw error
      }
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '登录失败，请重试',
      }
    } finally {
      this.loginInFlight = false
    }
  }

  async logout(): Promise<void> {
    if (this.logoutInFlight) throw new Error('退出登录正在进行，请稍候')
    this.logoutInFlight = true
    this.operationEpoch += 1
    try {
      if (this.sessionCookie) {
        try {
          await this.api.request('/api/v1/users/logout', { method: 'POST' })
        } catch {
          // Removing the local cookie completes logout even when remote invalidation is unavailable.
        }
      }
    } finally {
      try {
        this.clearLocalSession()
      } finally {
        this.logoutInFlight = false
      }
    }
  }

  clearSession(): void {
    this.operationEpoch += 1
    this.clearLocalSession()
  }

  private validateCredentials(email: string, password: string): string | null {
    if (!EMAIL_PATTERN.test(email) || email.length > 254) return '请输入有效邮箱'
    if (password.length < 1 || password.length > 1024) return '请输入有效密码'
    return null
  }

  private extractSession(cookies: string[]): string | null {
    for (const cookie of cookies) {
      const match = cookie.match(/(?:^|[,;]\s*)monkeycode_ai_session=([^;,]+)/)
      if (match?.[1]) return match[1]
    }
    return null
  }

  private clearLocalSession(): void {
    this.store.delete(SESSION_KEY)
    this.sessionCookie = null
  }

  private assertCurrentOperation(operation: number): void {
    if (operation !== this.operationEpoch) {
      throw new Error('登录操作已取消')
    }
  }
}
