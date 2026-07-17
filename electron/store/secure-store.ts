import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'

export class SecureStore {
  private filePath: string
  private cache: Record<string, unknown> = {}

  constructor(name: string) {
    this.filePath = path.join(app.getPath('userData'), `${name}.json`)
    try {
      if (fs.existsSync(this.filePath)) {
        this.cache = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'))
      }
    } catch {
      this.cache = {}
    }
  }

  get(key: string): string | null {
    return (this.cache[key] as string) ?? null
  }

  set(key: string, value: string): void {
    this.cache[key] = value
    this.persist()
  }

  delete(key: string): void {
    delete this.cache[key]
    this.persist()
  }

  private persist(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.cache, null, 2), 'utf-8')
    } catch {
      // ignore write errors
    }
  }
}
