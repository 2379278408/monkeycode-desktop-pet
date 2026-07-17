import Store from 'electron-store'

interface StoreSchema {
  [key: string]: string
}

export class SecureStore {
  private store: Store<StoreSchema>

  constructor(name: string) {
    this.store = new Store<StoreSchema>({
      name,
      encryptionKey: 'monkeycode-pet-key',
    } as any)
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
