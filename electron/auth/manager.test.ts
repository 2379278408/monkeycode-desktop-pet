import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type ApiResponse } from '../api/client'
import { AuthManager } from './manager'

describe('AuthManager', () => {
  const store = {
    get: vi.fn<() => string | null>(),
    set: vi.fn(),
    delete: vi.fn(),
  }
  const captcha = { obtainToken: vi.fn() }
  const api = {
    request: vi.fn(),
    requestWithMeta: vi.fn(),
  }

  beforeEach(() => {
    vi.resetAllMocks()
    store.get.mockReturnValue(null)
    captcha.obtainToken.mockResolvedValue('captcha-token')
    api.request.mockResolvedValue({ user: { id: 'u1' } })
    api.requestWithMeta.mockResolvedValue({
      data: {},
      status: 200,
      getSetCookies: () => [
        'monkeycode_ai_session=session-id; Path=/; HttpOnly; SameSite=Lax',
      ],
    } satisfies ApiResponse<unknown>)
  })

  function createAuth(): AuthManager {
    return new AuthManager({ store, captcha, api })
  }

  it('returns null when no session is stored', () => {
    expect(createAuth().getSession()).toBeNull()
  })

  it('obtains captcha before sending all login fields', async () => {
    const auth = createAuth()
    const result = await auth.loginWithCredentials(' user@example.com ', ' secret ')

    expect(result).toEqual({ success: true })
    expect(captcha.obtainToken).toHaveBeenCalledOnce()
    const [path, init] = api.requestWithMeta.mock.calls[0]
    expect(path).toBe('/api/v1/users/password-login')
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'user@example.com',
      password: ' secret ',
      captcha_token: 'captcha-token',
    })
    expect(store.set).toHaveBeenCalledWith('monkeycode_ai_session', 'session-id')
    expect(api.request).toHaveBeenCalledWith('/api/v1/users/status')
  })

  it('rejects invalid credentials before captcha', async () => {
    const result = await createAuth().loginWithCredentials('bad-email', 'password')

    expect(result.success).toBe(false)
    expect(captcha.obtainToken).not.toHaveBeenCalled()
  })

  it('returns the backend business error', async () => {
    api.requestWithMeta.mockRejectedValue(new ApiError('登录失败', 200, 10606))

    await expect(createAuth().loginWithCredentials('user@example.com', 'bad'))
      .resolves.toEqual({ success: false, error: '登录失败' })
  })

  it('rejects a response without the session cookie', async () => {
    api.requestWithMeta.mockResolvedValue({
      data: {},
      status: 200,
      getSetCookies: () => [],
    })

    const result = await createAuth().loginWithCredentials('user@example.com', 'password')
    expect(result.error).toContain('缺少会话信息')
  })

  it('clears an invalid stored session', async () => {
    store.get.mockReturnValue('expired-session')
    api.request.mockRejectedValue(new ApiError('未登录', 401, 401))
    const auth = createAuth()

    await expect(auth.validateSession()).resolves.toBe(false)
    expect(auth.getSession()).toBeNull()
    expect(store.delete).toHaveBeenCalledWith('monkeycode_ai_session')
  })

  it('reports persistence failures without keeping the session in memory', async () => {
    store.set.mockImplementation(() => { throw new Error('系统安全存储不可用') })
    const auth = createAuth()

    const result = await auth.loginWithCredentials('user@example.com', 'password')
    expect(result.error).toBe('系统安全存储不可用')
    expect(auth.getSession()).toBeNull()
  })

  it('calls server logout and clears local state', async () => {
    store.get.mockReturnValue('session-id')
    const auth = createAuth()

    await auth.logout()

    expect(api.request).toHaveBeenCalledWith('/api/v1/users/logout', { method: 'POST' })
    expect(store.delete).toHaveBeenCalledWith('monkeycode_ai_session')
    expect(auth.getSession()).toBeNull()
  })

  it('serializes concurrent login attempts', async () => {
    let resolveCaptcha: ((token: string) => void) | undefined
    captcha.obtainToken.mockImplementation(() => new Promise<string>((resolve) => {
      resolveCaptcha = resolve
    }))
    const auth = createAuth()

    const first = auth.loginWithCredentials('user@example.com', 'password')
    const second = await auth.loginWithCredentials('user@example.com', 'password')
    expect(second).toEqual({ success: false, error: '登录正在进行，请稍候' })

    resolveCaptcha?.('captcha-token')
    await expect(first).resolves.toEqual({ success: true })
    expect(api.requestWithMeta).toHaveBeenCalledOnce()
  })

  it('cancels a pending login when logout starts', async () => {
    let resolveCaptcha: ((token: string) => void) | undefined
    captcha.obtainToken.mockImplementation(() => new Promise<string>((resolve) => {
      resolveCaptcha = resolve
    }))
    const auth = createAuth()
    const login = auth.loginWithCredentials('user@example.com', 'password')

    await auth.logout()
    resolveCaptcha?.('captcha-token')

    await expect(login).resolves.toEqual({ success: false, error: '登录操作已取消' })
    expect(api.requestWithMeta).not.toHaveBeenCalled()
  })

  it('does not clear a newer session when old validation expires', async () => {
    store.get.mockReturnValue('old-session')
    let rejectValidation: ((error: unknown) => void) | undefined
    api.request.mockImplementationOnce(() => new Promise((_resolve, reject) => {
      rejectValidation = reject
    }))
    const auth = createAuth()
    const validation = auth.validateSession()
    const login = auth.loginWithCredentials('user@example.com', 'password')
    await vi.waitFor(() => expect(api.requestWithMeta).toHaveBeenCalledOnce())
    await expect(login).resolves.toEqual({ success: true })

    rejectValidation?.(new ApiError('未登录', 401, 401))
    await expect(validation).resolves.toBe(false)
    expect(auth.getSession()).toBe('session-id')
  })

  it('keeps the in-memory session when durable deletion fails', () => {
    store.get.mockReturnValue('session-id')
    store.delete.mockImplementation(() => { throw new Error('disk full') })
    const auth = createAuth()

    expect(() => auth.clearSession()).toThrow('disk full')
    expect(auth.getSession()).toBe('session-id')
  })

  it('completes local logout when the server is unavailable', async () => {
    store.get.mockReturnValue('session-id')
    api.request.mockRejectedValue(new Error('network unavailable'))
    const auth = createAuth()

    await expect(auth.logout()).resolves.toBeUndefined()
    expect(auth.getSession()).toBeNull()
    expect(store.delete).toHaveBeenCalledWith('monkeycode_ai_session')
  })

  it('rejects login while logout is pending', async () => {
    store.get.mockReturnValue('session-id')
    let resolveLogout: (() => void) | undefined
    api.request.mockImplementation(() => new Promise<void>((resolve) => {
      resolveLogout = resolve
    }))
    const auth = createAuth()
    const logout = auth.logout()

    await expect(auth.loginWithCredentials('user@example.com', 'password'))
      .resolves.toEqual({ success: false, error: '退出登录正在进行，请稍候' })
    resolveLogout?.()
    await expect(logout).resolves.toBeUndefined()
  })
})
