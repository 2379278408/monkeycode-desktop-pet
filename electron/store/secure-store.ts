import Store from 'electron-store'

export class SecureStore {
  private store: Store

  constructor(name: string) {
    this.store = new Store({ projectName: name, encryptionKey: 'monkeycode-pet-key' })
  }

  get(key: string): string | null {
    return (this.store.get(key) as string) ?? null
  }

  set(key: string, value: string): void {
    this.store.set(key, value)
  }

  delete(key: string): void {
    this.store.delete(key)
  }
}
