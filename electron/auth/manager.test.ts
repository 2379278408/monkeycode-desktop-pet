import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockStoreGet = vi.fn().mockReturnValue(null)
const mockStoreSet = vi.fn()
const mockStoreDelete = vi.fn()

vi.mock('../store/secure-store', () => ({
  SecureStore: class {
    get = mockStoreGet
    set = mockStoreSet
    delete = mockStoreDelete
  },
}))

vi.mock('electron', () => ({
  BrowserWindow: vi.fn().mockImplementation(() => ({
    loadURL: vi.fn(),
    webContents: {
      on: vi.fn(),
      session: {
        cookies: {
          get: vi.fn().mockResolvedValue([{ value: 'test-session' }]),
        },
      },
    },
    on: vi.fn(),
    close: vi.fn(),
  })),
}))

describe('AuthManager', () => {
  let auth: AuthManager

  beforeEach(async () => {
    vi.clearAllMocks()
    mockStoreGet.mockReturnValue(null)
    const { AuthManager } = await import('./manager')
    auth = new AuthManager()
  })

  it('should return null session when not logged in', () => {
    expect(auth.getSession()).toBeNull()
  })

  it('should validate session against API', async () => {
    mockStoreGet.mockReturnValue('test-session')
    const { AuthManager } = await import('./manager')
    const authWithSession = new AuthManager()

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ code: 0, data: { id: 'user1' } }),
    })

    const result = await authWithSession.validateSession()
    expect(result).toBe(true)
  })

  it('should return false and clear session when API returns 401', async () => {
    mockStoreGet.mockReturnValue('test-session')
    const { AuthManager } = await import('./manager')
    const authWithSession = new AuthManager()

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
    })

    const result = await authWithSession.validateSession()
    expect(result).toBe(false)
    expect(authWithSession.getSession()).toBeNull()
  })
})
