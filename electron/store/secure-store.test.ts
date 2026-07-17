import { describe, it, expect, beforeEach } from 'vitest'
import { SecureStore } from './secure-store'

describe('SecureStore', () => {
  let store: SecureStore

  beforeEach(() => {
    store = new SecureStore('test-store')
  })

  it('should store and retrieve a value', () => {
    store.set('session', 'abc123')
    expect(store.get('session')).toBe('abc123')
  })

  it('should return null for non-existent key', () => {
    expect(store.get('nonexistent')).toBeNull()
  })

  it('should delete a value', () => {
    store.set('session', 'abc123')
    store.delete('session')
    expect(store.get('session')).toBeNull()
  })
})
