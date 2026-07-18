import { describe, expect, it } from 'vitest'
import {
  anchoredBottomCenterBounds,
  canEnableMousePassthrough,
  clampWindowPosition,
  draggedWindowBounds,
  isRectangleCoveredByWorkAreas,
  WINDOW_SIZES,
} from './interaction'

describe('canEnableMousePassthrough', () => {
  it('allows passthrough only in pet modes without an active drag', () => {
    expect(canEnableMousePassthrough('collapsed', false)).toBe(true)
    expect(canEnableMousePassthrough('expanded', false)).toBe(true)
    expect(canEnableMousePassthrough('auth', false)).toBe(false)
    expect(canEnableMousePassthrough('collapsed', true)).toBe(false)
  })
})

describe('WINDOW_SIZES', () => {
  it('defines every supported window mode', () => {
    expect(WINDOW_SIZES).toEqual({
      auth: { width: 380, height: 430 },
      collapsed: { width: 180, height: 190 },
      expanded: { width: 380, height: 430 },
    })
  })
})

describe('clampWindowPosition', () => {
  it('supports negative work-area coordinates', () => {
    expect(clampWindowPosition(
      { x: -2100, y: -200 },
      { width: 380, height: 430 },
      { x: -1920, y: -100, width: 1920, height: 1080 },
    )).toEqual({ x: -1920, y: -100 })
  })

  it('pins an oversized window to the work-area origin', () => {
    expect(clampWindowPosition(
      { x: 100, y: 200 },
      { width: 2000, height: 1200 },
      { x: -1920, y: 0, width: 1920, height: 1080 },
    )).toEqual({ x: -1920, y: 0 })
  })
})

describe('draggedWindowBounds', () => {
  it('moves from the fixed starting bounds using the latest DIP cursor', () => {
    expect(draggedWindowBounds(
      { x: 400, y: 300, width: 380, height: 430 },
      { x: 600, y: 500 },
      { x: 645, y: 530 },
    )).toEqual({ x: 445, y: 330, width: 380, height: 430 })
  })
})

describe('anchoredBottomCenterBounds', () => {
  it('keeps the collapsed and expanded bottom-center identical without clamping', () => {
    const oldBounds = { x: 500, y: 400, width: 180, height: 190 }
    const bounds = anchoredBottomCenterBounds(
      oldBounds,
      WINDOW_SIZES.expanded,
      { x: 0, y: 0, width: 1920, height: 1080 },
    )

    expect(bounds).toEqual({ x: 400, y: 160, width: 380, height: 430 })
    expect({
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height,
    }).toEqual({
      x: oldBounds.x + oldBounds.width / 2,
      y: oldBounds.y + oldBounds.height,
    })
  })

  it('clamps the anchored bounds at a work-area edge', () => {
    expect(anchoredBottomCenterBounds(
      { x: -1910, y: 10, width: 180, height: 190 },
      WINDOW_SIZES.expanded,
      { x: -1920, y: 0, width: 1920, height: 1080 },
    )).toEqual({ x: -1920, y: 0, width: 380, height: 430 })
  })
})

describe('isRectangleCoveredByWorkAreas', () => {
  it('keeps a candidate spanning horizontally adjacent work areas', () => {
    const candidate = { x: -100, y: 200, width: 200, height: 300 }
    const covered = isRectangleCoveredByWorkAreas(candidate, [
      { x: -1920, y: 0, width: 1920, height: 1080 },
      { x: 0, y: 0, width: 1920, height: 1080 },
    ])

    expect(covered).toBe(true)
    expect(covered ? { x: candidate.x, y: candidate.y } : null).toEqual({ x: -100, y: 200 })
  })

  it('rejects a candidate crossing a horizontal gap', () => {
    expect(isRectangleCoveredByWorkAreas(
      { x: -100, y: 200, width: 200, height: 300 },
      [
        { x: -1920, y: 0, width: 1910, height: 1080 },
        { x: 10, y: 0, width: 1910, height: 1080 },
      ],
    )).toBe(false)
  })

  it('supports vertically adjacent work areas at negative coordinates', () => {
    expect(isRectangleCoveredByWorkAreas(
      { x: -800, y: -100, width: 300, height: 200 },
      [
        { x: -1920, y: -1080, width: 1920, height: 1080 },
        { x: -1920, y: 0, width: 1920, height: 1080 },
      ],
    )).toBe(true)
  })

  it('supports horizontally adjacent work areas entirely in negative space', () => {
    expect(isRectangleCoveredByWorkAreas(
      { x: -2020, y: -500, width: 200, height: 300 },
      [
        { x: -3840, y: -1080, width: 1920, height: 1080 },
        { x: -1920, y: -1080, width: 1920, height: 1080 },
      ],
    )).toBe(true)
  })
})
