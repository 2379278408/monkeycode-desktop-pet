import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_PET_LIFE_SNAPSHOT_BYTES,
  assertPetLifeSnapshotPayload,
} from './validation'

const SAVE_ERROR_MESSAGE = '桌宠生命状态保存失败'
const validSnapshot = {
  mood: 50,
  satiety: 60,
  energy: 70,
  sleeping: false,
  lastCalculatedAt: 1,
  lastInteractionAt: 1,
}

function getValidationError(payload: unknown): Error {
  try {
    assertPetLifeSnapshotPayload(payload)
  } catch (error) {
    expect(error).toBeInstanceOf(Error)
    return error as Error
  }
  throw new Error('Expected payload validation to fail')
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('assertPetLifeSnapshotPayload', () => {
  it('returns a new exact snapshot for a valid payload', () => {
    const result = assertPetLifeSnapshotPayload(validSnapshot)

    expect(result).toEqual(validSnapshot)
    expect(result).not.toBe(validSnapshot)
    expect(Object.keys(result).sort()).toEqual(Object.keys(validSnapshot).sort())
  })

  it.each([
    ['an extra field', { ...validSnapshot, padding: 'unexpected' }],
    ['a missing field', {
      mood: 50,
      satiety: 60,
      energy: 70,
      sleeping: false,
      lastCalculatedAt: 1,
    }],
  ])('rejects %s', (_case, payload) => {
    expect(() => assertPetLifeSnapshotPayload(payload)).toThrowError(SAVE_ERROR_MESSAGE)
  })

  it('ignores symbol and non-enumerable fields outside the JSON envelope', () => {
    const symbolPayload = { ...validSnapshot, [Symbol('secret')]: 'unexpected' }
    const nonEnumerablePayload = { ...validSnapshot }
    Object.defineProperty(nonEnumerablePayload, 'secret', { value: 'unexpected' })

    expect(assertPetLifeSnapshotPayload(symbolPayload)).toEqual(validSnapshot)
    expect(assertPetLifeSnapshotPayload(nonEnumerablePayload)).toEqual(validSnapshot)
  })

  it('rejects a required field that is absent from the JSON envelope', () => {
    const payload = { ...validSnapshot }
    Object.defineProperty(payload, 'mood', { enumerable: false })

    expect(() => assertPetLifeSnapshotPayload(payload)).toThrowError(SAVE_ERROR_MESSAGE)
  })

  it('reads a stateful getter only once during JSON serialization', () => {
    const payload = { ...validSnapshot }
    let moodReads = 0
    Object.defineProperty(payload, 'mood', {
      enumerable: true,
      get: () => {
        moodReads += 1
        if (moodReads > 1) throw new Error('mood read twice')
        return validSnapshot.mood
      },
    })

    expect(assertPetLifeSnapshotPayload(payload)).toEqual(validSnapshot)
    expect(moodReads).toBe(1)
  })

  it('does not observe a dynamic Proxy after JSON serialization', () => {
    let ownKeysCalls = 0
    const fieldReads = new Map<PropertyKey, number>()
    const payload = new Proxy({ ...validSnapshot }, {
      ownKeys: (target) => {
        ownKeysCalls += 1
        if (ownKeysCalls > 1) throw new Error('ownKeys called twice')
        return Reflect.ownKeys(target)
      },
      get: (target, property, receiver) => {
        if (Object.prototype.hasOwnProperty.call(validSnapshot, property)) {
          const reads = (fieldReads.get(property) ?? 0) + 1
          fieldReads.set(property, reads)
          if (reads > 1) throw new Error(`${String(property)} read twice`)
        }
        return Reflect.get(target, property, receiver)
      },
    })

    expect(assertPetLifeSnapshotPayload(payload)).toEqual(validSnapshot)
    expect(ownKeysCalls).toBe(1)
    expect([...fieldReads.values()]).toEqual([1, 1, 1, 1, 1, 1])
  })

  it('accepts an inherited toJSON result and returns a plain snapshot', () => {
    const prototype = {
      toJSON: () => ({ ...validSnapshot }),
    }
    const payload = Object.assign(Object.create(prototype) as Record<string, unknown>, {
      ignoredByToJSON: 'outside-envelope',
    })

    const result = assertPetLifeSnapshotPayload(payload)

    expect(result).toEqual(validSnapshot)
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
    expect(result).not.toBe(payload)
  })

  it.each([
    ['mood string', { ...validSnapshot, mood: '50' }],
    ['mood NaN', { ...validSnapshot, mood: Number.NaN }],
    ['satiety Infinity', { ...validSnapshot, satiety: Number.POSITIVE_INFINITY }],
    ['energy negative Infinity', { ...validSnapshot, energy: Number.NEGATIVE_INFINITY }],
    ['sleeping number', { ...validSnapshot, sleeping: 0 }],
    ['lastCalculatedAt string', { ...validSnapshot, lastCalculatedAt: '1' }],
    ['lastInteractionAt boolean', { ...validSnapshot, lastInteractionAt: true }],
  ])('rejects an invalid %s', (_case, payload) => {
    expect(() => assertPetLifeSnapshotPayload(payload)).toThrowError(SAVE_ERROR_MESSAGE)
  })

  it.each([
    ['null', null],
    ['array', []],
  ])('rejects %s', (_case, payload) => {
    expect(() => assertPetLifeSnapshotPayload(payload)).toThrowError(SAVE_ERROR_MESSAGE)
  })

  it('rejects a cyclic payload', () => {
    const payload: Record<string, unknown> = { ...validSnapshot }
    payload.self = payload

    expect(() => assertPetLifeSnapshotPayload(payload)).toThrowError(SAVE_ERROR_MESSAGE)
  })

  it('rejects a BigInt payload', () => {
    expect(() => assertPetLifeSnapshotPayload({
      ...validSnapshot,
      mood: BigInt(50),
    })).toThrowError(SAVE_ERROR_MESSAGE)
  })

  it('rejects an oversized extra-field envelope before field validation', () => {
    expect(MAX_PET_LIFE_SNAPSHOT_BYTES).toBe(16 * 1024)
    const payload = {
      ...validSnapshot,
      padding: 'x'.repeat(MAX_PET_LIFE_SNAPSHOT_BYTES),
    }
    const parse = vi.spyOn(JSON, 'parse')

    expect(() => assertPetLifeSnapshotPayload(payload)).toThrowError(SAVE_ERROR_MESSAGE)
    expect(parse).not.toHaveBeenCalled()
  })

  it('measures the envelope limit in UTF-8 bytes', () => {
    const payload = {
      ...validSnapshot,
      padding: '界'.repeat(Math.ceil(MAX_PET_LIFE_SNAPSHOT_BYTES / 3)),
    }
    expect(JSON.stringify(payload).length).toBeLessThan(MAX_PET_LIFE_SNAPSHOT_BYTES)
    expect(new TextEncoder().encode(JSON.stringify(payload)).byteLength)
      .toBeGreaterThan(MAX_PET_LIFE_SNAPSHOT_BYTES)

    expect(() => assertPetLifeSnapshotPayload(payload)).toThrowError(SAVE_ERROR_MESSAGE)
  })

  it('always returns a fixed error without input details', () => {
    const sensitiveValue = 'do-not-leak-payload-value'
    const error = getValidationError({ ...validSnapshot, mood: sensitiveValue })

    expect(error.message).toBe(SAVE_ERROR_MESSAGE)
    expect(String(error)).not.toContain(sensitiveValue)
  })
})
