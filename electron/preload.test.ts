import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_PET_LIFE_SNAPSHOT_BYTES } from './pet-life/validation'

const electronMocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: electronMocks.exposeInMainWorld,
  },
  ipcRenderer: {
    invoke: electronMocks.invoke,
    on: electronMocks.on,
    removeListener: electronMocks.removeListener,
  },
}))

await import('./preload')

interface ExposedApi {
  savePetLife(snapshot: unknown): Promise<void>
}

const exposedApi = electronMocks.exposeInMainWorld.mock.calls[0]?.[1] as ExposedApi
const validSnapshot = {
  mood: 50,
  satiety: 60,
  energy: 70,
  sleeping: false,
  lastCalculatedAt: 1,
  lastInteractionAt: 1,
}

beforeEach(() => {
  electronMocks.invoke.mockReset()
})

describe('preload pet-life boundary', () => {
  it('invokes save once with a plain six-field copy', async () => {
    electronMocks.invoke.mockResolvedValue(undefined)
    const payload = { ...validSnapshot }

    await exposedApi.savePetLife(payload)

    expect(electronMocks.invoke).toHaveBeenCalledOnce()
    expect(electronMocks.invoke).toHaveBeenCalledWith('pet-life:save', validSnapshot)
    const invokedPayload = electronMocks.invoke.mock.calls[0][1]
    expect(invokedPayload).not.toBe(payload)
    expect(Object.getPrototypeOf(invokedPayload)).toBe(Object.prototype)
    expect(Object.keys(invokedPayload).sort()).toEqual(Object.keys(validSnapshot).sort())
  })

  it.each([
    ['an extra field', { ...validSnapshot, extra: 'unexpected' }],
    ['an oversized envelope', {
      ...validSnapshot,
      extra: 'x'.repeat(MAX_PET_LIFE_SNAPSHOT_BYTES),
    }],
    ['an invalid field type', { ...validSnapshot, mood: '50' }],
  ])('rejects %s before invoking Main', (_case, payload) => {
    expect(() => exposedApi.savePetLife(payload)).toThrowError('桌宠生命状态保存失败')
    expect(electronMocks.invoke).not.toHaveBeenCalled()
  })
})
