import { beforeEach, describe, expect, it, vi } from 'vitest'

let fileContents: string | null = null
let encryptionAvailable = true
let writeFailure = false

vi.mock('electron', () => ({
  app: { getPath: () => '/virtual-user-data' },
  safeStorage: {
    isEncryptionAvailable: () => encryptionAvailable,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
    decryptString: (value: Buffer) => value.toString().replace(/^encrypted:/, ''),
  },
}))

vi.mock('fs', () => ({
  existsSync: () => fileContents !== null,
  readFileSync: () => fileContents,
  writeFileSync: (_path: string, value: string) => {
    if (writeFailure) throw new Error('disk full')
    fileContents = value
  },
  renameSync: vi.fn(),
}))

import { SecureStore } from './secure-store'

describe('SecureStore', () => {
  let store: SecureStore

  beforeEach(() => {
    fileContents = null
    encryptionAvailable = true
    writeFailure = false
    store = new SecureStore('test-store')
  })

  it('should store and retrieve a value', () => {
    store.set('session', 'abc123')
    expect(store.get('session')).toBe('abc123')
    expect(fileContents).not.toContain('abc123')
  })

  it('should return null for non-existent key', () => {
    expect(store.get('nonexistent')).toBeNull()
  })

  it('should delete a value', () => {
    store.set('session', 'abc123')
    store.delete('session')
    expect(store.get('session')).toBeNull()
  })

  it('restores an encrypted value', () => {
    store.set('session', 'abc123')
    const restored = new SecureStore('test-store')

    expect(restored.get('session')).toBe('abc123')
  })

  it('migrates a legacy plaintext value to encrypted storage', () => {
    fileContents = JSON.stringify({ session: 'legacy-session' })
    const migrated = new SecureStore('test-store')

    expect(migrated.get('session')).toBe('legacy-session')
    expect(fileContents).not.toContain('legacy-session')
  })

  it('rejects persistence when encryption is unavailable', () => {
    encryptionAvailable = false

    expect(() => store.set('session', 'abc123')).toThrow('系统安全存储不可用')
  })

  it('keeps memory unchanged when persistence fails', () => {
    store.set('session', 'old-session')
    writeFailure = true

    expect(() => store.set('session', 'new-session')).toThrow('disk full')
    expect(store.get('session')).toBe('old-session')
  })
})
