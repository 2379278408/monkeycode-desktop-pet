import { beforeEach, describe, expect, it, vi } from 'vitest'
import { savePetLifePayload } from './ipc'
import { MAX_PET_LIFE_SNAPSHOT_BYTES, type PetLifeSnapshot } from './validation'

const validSnapshot = {
  mood: 50,
  satiety: 60,
  energy: 70,
  sleeping: false,
  lastCalculatedAt: 1,
  lastInteractionAt: 1,
}
const save = vi.fn<(snapshot: PetLifeSnapshot) => void>()
const store = { save }

beforeEach(() => {
  save.mockReset()
})

describe('savePetLifePayload', () => {
  it('saves a valid plain snapshot copy once', () => {
    const payload = { ...validSnapshot }

    savePetLifePayload(store, payload)

    expect(save).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledWith(validSnapshot)
    const savedPayload = save.mock.calls[0][0]
    expect(savedPayload).not.toBe(payload)
    expect(Object.getPrototypeOf(savedPayload)).toBe(Object.prototype)
  })

  it.each([
    ['an extra field', { ...validSnapshot, extra: 'unexpected' }],
    ['an oversized envelope', {
      ...validSnapshot,
      extra: 'x'.repeat(MAX_PET_LIFE_SNAPSHOT_BYTES),
    }],
    ['an invalid field type', { ...validSnapshot, sleeping: 0 }],
  ])('rejects %s without saving', (_case, payload) => {
    expect(() => savePetLifePayload(store, payload))
      .toThrowError('桌宠生命状态保存失败')
    expect(save).not.toHaveBeenCalled()
  })
})
