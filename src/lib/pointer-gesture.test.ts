import { describe, expect, it } from 'vitest'
import { classifyGesture } from './pointer-gesture'

describe('classifyGesture', () => {
  it('classifies movement below the threshold as a click', () => {
    expect(classifyGesture({ x: 10, y: 10 }, { x: 12, y: 13 }, 5)).toBe('click')
  })

  it('classifies movement above the threshold as a drag', () => {
    expect(classifyGesture({ x: 0, y: 0 }, { x: 6, y: 8 }, 5)).toBe('drag')
  })

  it('classifies exactly five pixels as a drag', () => {
    expect(classifyGesture({ x: 0, y: 0 }, { x: 3, y: 4 }, 5)).toBe('drag')
  })

  it('rejects a negative threshold', () => {
    expect(() => classifyGesture({ x: 0, y: 0 }, { x: 0, y: 0 }, -1)).toThrow(RangeError)
  })
})
