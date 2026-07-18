import { app, safeStorage } from 'electron'
import * as path from 'path'
import * as fs from 'fs'

interface StoredFile {
  version: 1
  values: Record<string, { encrypted: string }>
}

export class SecureStore {
  private filePath: string
  private cache: Record<string, unknown> = {}

  constructor(name: string) {
    this.filePath = path.join(app.getPath('userData'), `${name}.json`)
    try {
      if (fs.existsSync(this.filePath)) {
        const loaded: Record<string, unknown> = {}
        const stored = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as
          | StoredFile
          | Record<string, unknown>
        if (this.isStoredFile(stored)) {
          if (!safeStorage.isEncryptionAvailable()) return
          for (const [key, value] of Object.entries(stored.values)) {
            loaded[key] = safeStorage.decryptString(
              Buffer.from(value.encrypted, 'base64'),
            )
          }
        } else if (safeStorage.isEncryptionAvailable()) {
          for (const [key, value] of Object.entries(stored)) {
            if (typeof value === 'string') loaded[key] = value
          }
          this.persistSnapshot(loaded)
        }
        this.cache = loaded
      }
    } catch (error) {
      console.warn('[SecureStore] 无法读取或迁移安全存储',
        error instanceof Error ? error.message : 'unknown error')
      this.cache = {}
    }
  }

  get(key: string): string | null {
    return (this.cache[key] as string) ?? null
  }

  set(key: string, value: string): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('系统安全存储不可用，无法保存登录状态')
    }
    const next = { ...this.cache, [key]: value }
    this.persistSnapshot(next)
    this.cache = next
  }

  delete(key: string): void {
    const next = { ...this.cache }
    delete next[key]
    this.persistSnapshot(next)
    this.cache = next
  }

  private persistSnapshot(snapshot: Record<string, unknown>): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('系统安全存储不可用，无法保存登录状态')
    }

    const values = Object.fromEntries(
      Object.entries(snapshot).map(([key, value]) => [
        key,
        {
          encrypted: safeStorage
            .encryptString(String(value))
            .toString('base64'),
        },
      ]),
    )
    const stored: StoredFile = { version: 1, values }
    const temporaryPath = `${this.filePath}.tmp`
    fs.writeFileSync(temporaryPath, JSON.stringify(stored, null, 2), 'utf-8')
    fs.renameSync(temporaryPath, this.filePath)
  }

  private isStoredFile(value: unknown): value is StoredFile {
    if (!value || typeof value !== 'object') return false
    const candidate = value as Partial<StoredFile>
    return candidate.version === 1
      && !!candidate.values
      && typeof candidate.values === 'object'
  }
}
