import type { ApiEnvelope } from './types'

const DEFAULT_API_BASE = 'https://monkeycode-ai.com'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly code?: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }

  get isAuthError(): boolean {
    return this.httpStatus === 401 || this.httpStatus === 403
      || this.code === 401 || this.code === 403
  }
}

export interface ApiResponse<T> {
  data: T
  status: number
  getSetCookies: () => string[]
}

export interface ApiClientOptions {
  baseUrl?: string
  getSession?: () => string | null
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export class ApiClient {
  private readonly baseUrl: string
  private readonly getSession: () => string | null
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_API_BASE).replace(/\/$/, '')
    this.getSession = options.getSession ?? (() => null)
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
    this.timeoutMs = options.timeoutMs ?? 15_000
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    return (await this.requestWithMeta<T>(path, init)).data
  }

  async requestWithMeta<T>(path: string, init: RequestInit = {}): Promise<ApiResponse<T>> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs)
    const headers = new Headers(init.headers)
    const session = this.getSession()

    if (init.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }
    if (session) {
      headers.set('Cookie', `monkeycode_ai_session=${session}`)
    }

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      })
      const envelope = await this.parseEnvelope<T>(response)

      if (!response.ok || envelope.code !== 0) {
        throw new ApiError(
          envelope.message || `请求失败 (${response.status})`,
          response.status,
          envelope.code,
        )
      }

      return {
        data: envelope.data,
        status: response.status,
        getSetCookies: () => this.getSetCookies(response.headers),
      }
    } catch (error) {
      if (error instanceof ApiError) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ApiError('请求超时，请稍后重试', 0)
      }
      throw new ApiError('网络连接失败，请检查网络后重试', 0)
    } finally {
      clearTimeout(timeoutId)
    }
  }

  private async parseEnvelope<T>(response: Response): Promise<ApiEnvelope<T>> {
    try {
      const body = await response.json() as unknown
      if (!body || typeof body !== 'object'
        || typeof (body as Partial<ApiEnvelope<T>>).code !== 'number') {
        throw new ApiError('服务响应格式异常，请稍后重试', response.status)
      }
      return body as ApiEnvelope<T>
    } catch {
      throw new ApiError('服务响应格式异常，请稍后重试', response.status)
    }
  }

  private getSetCookies(headers: Headers): string[] {
    const extendedHeaders = headers as Headers & { getSetCookie?: () => string[] }
    if (typeof extendedHeaders.getSetCookie === 'function') {
      return extendedHeaders.getSetCookie()
    }
    const cookie = headers.get('set-cookie')
    return cookie ? [cookie] : []
  }
}
