import { describe, expect, it, vi } from 'vitest'
import { ApiClient, ApiError } from './client'

function response(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), { status, headers })
}

describe('ApiClient', () => {
  it('returns data from a successful envelope', async () => {
    const client = new ApiClient({
      fetchImpl: vi.fn().mockResolvedValue(response({ code: 0, data: { id: 'u1' } })),
    })

    await expect(client.request('/status')).resolves.toEqual({ id: 'u1' })
  })

  it('rejects a nonzero business code on HTTP 200', async () => {
    const client = new ApiClient({
      fetchImpl: vi.fn().mockResolvedValue(response({ code: 10606, message: '登录失败' })),
    })

    await expect(client.request('/login')).rejects.toMatchObject({
      name: 'ApiError',
      code: 10606,
      message: '登录失败',
    })
  })

  it('rejects an HTTP error', async () => {
    const client = new ApiClient({
      fetchImpl: vi.fn().mockResolvedValue(response({ code: 403, message: '禁止访问' }, 403)),
    })

    await expect(client.request('/login')).rejects.toBeInstanceOf(ApiError)
  })

  it('injects the session cookie', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ code: 0, data: {} }))
    const client = new ApiClient({ fetchImpl, getSession: () => 'session-id' })

    await client.request('/status')

    const init = fetchImpl.mock.calls[0][1] as RequestInit
    expect(new Headers(init.headers).get('Cookie')).toBe('monkeycode_ai_session=session-id')
  })

  it('exposes set-cookie values', async () => {
    const client = new ApiClient({
      fetchImpl: vi.fn().mockResolvedValue(response(
        { code: 0, data: {} },
        200,
        { 'set-cookie': 'monkeycode_ai_session=abc; Path=/; HttpOnly' },
      )),
    })

    const result = await client.requestWithMeta('/login')
    expect(result.getSetCookies()).toEqual([
      'monkeycode_ai_session=abc; Path=/; HttpOnly',
    ])
  })

  it('maps an aborted request to a timeout error', async () => {
    const fetchImpl = vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'))
      })
    })) as typeof fetch
    const client = new ApiClient({ fetchImpl, timeoutMs: 1 })

    await expect(client.request('/slow')).rejects.toMatchObject({
      message: '请求超时，请稍后重试',
    })
  })

  it('rejects an HTTP 200 response without an explicit business code', async () => {
    const client = new ApiClient({
      fetchImpl: vi.fn().mockResolvedValue(response({ data: { id: 'u1' } })),
    })

    await expect(client.request('/status')).rejects.toMatchObject({
      message: '服务响应格式异常，请稍后重试',
    })
  })

  it('rejects non-JSON success responses', async () => {
    const client = new ApiClient({
      fetchImpl: vi.fn().mockResolvedValue(new Response('<html>error</html>', { status: 200 })),
    })

    await expect(client.request('/status')).rejects.toBeInstanceOf(ApiError)
  })
})
