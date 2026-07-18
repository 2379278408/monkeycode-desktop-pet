import { describe, expect, it } from 'vitest'
import {
  appendGesturePoint,
  classifyGesture,
  classifyReleaseIntent,
  type GesturePoint,
  type GestureSession,
} from './pointer-gesture'

const makeSession = (
  points: GesturePoint[],
  previousClickAt: number | null = null,
  lockedIntent: GestureSession['lockedIntent'] = null,
): GestureSession => ({ points, previousClickAt, lockedIntent })

const makePetCandidate = (points: GesturePoint[]): GestureSession => {
  let session = makeSession([points[0]])
  session = appendGesturePoint(session, {
    ...points[0],
    at: points[0].at + 350,
  })
  for (const point of points.slice(1)) session = appendGesturePoint(session, point)
  return session
}

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

describe('pointer gesture sessions', () => {
  it('classifies a quick stationary release as click', () => {
    expect(classifyReleaseIntent(makeSession([
      { x: 0, y: 0, at: 0 },
      { x: 2, y: 1, at: 120 },
    ]))).toBe('click')
  })

  it.each([
    { previousClickAt: 50, releaseAt: 350, expected: 'double-click' },
    { previousClickAt: 49, releaseAt: 350, expected: 'click' },
  ] as const)('classifies a click interval at the $expected boundary', ({
    previousClickAt,
    releaseAt,
    expected,
  }) => {
    expect(classifyReleaseIntent(makeSession([
      { x: 0, y: 0, at: 300 },
      { x: 1, y: 1, at: releaseAt },
    ], previousClickAt))).toBe(expected)
  })

  it('locks drag at exactly five pixels within 350ms', () => {
    const session = appendGesturePoint(
      makeSession([{ x: 0, y: 0, at: 0 }]),
      { x: 3, y: 4, at: 350 },
    )

    expect(session.lockedIntent).toBe('drag')
    expect(classifyReleaseIntent(session)).toBe('drag')
  })

  it('locks a stationary hold at exactly 350ms as pet-candidate', () => {
    const session = appendGesturePoint(
      makeSession([{ x: 0, y: 0, at: 0 }]),
      { x: 0, y: 0, at: 350 },
    )

    expect(session.lockedIntent).toBe('pet-candidate')
  })

  it('keeps a locked drag after a long hold', () => {
    const session = appendGesturePoint(
      makeSession([{ x: 0, y: 0, at: 0 }], null, 'drag'),
      { x: 0, y: 0, at: 500 },
    )

    expect(session.lockedIntent).toBe('drag')
  })

  it('keeps pet-candidate locked after later large movement', () => {
    const session = appendGesturePoint(
      makeSession([{ x: 0, y: 0, at: 0 }], null, 'pet-candidate'),
      { x: 100, y: 0, at: 500 },
    )

    expect(session.lockedIntent).toBe('pet-candidate')
  })

  it('keeps only the latest 32 points', () => {
    let session = makeSession([{ x: 0, y: 0, at: 0 }], null, 'pet-candidate')
    for (let index = 1; index <= 40; index += 1) {
      session = appendGesturePoint(session, { x: index, y: 0, at: index })
    }

    expect(session.points).toHaveLength(32)
    expect(session.points[0]).toEqual({ x: 9, y: 0, at: 9 })
    expect(session.points[31]).toEqual({ x: 40, y: 0, at: 40 })
  })

  it.each([
    { distance: 79, expected: null },
    { distance: 80, expected: 'pet' },
  ] as const)('requires at least $distance pixels for $expected', ({ distance, expected }) => {
    const edge = distance / 4
    expect(classifyReleaseIntent(makePetCandidate([
      { x: 0, y: 0, at: 0 },
      { x: edge, y: 0, at: 400 },
      { x: 0, y: 0, at: 500 },
      { x: edge, y: 0, at: 600 },
      { x: 0, y: 0, at: 700 },
    ]))).toBe(expected)
  })

  it.each([
    {
      points: [
        { x: 0, y: 0, at: 0 },
        { x: 40, y: 0, at: 400 },
        { x: 0, y: 0, at: 500 },
      ],
      expected: null,
    },
    {
      points: [
        { x: 0, y: 0, at: 0 },
        { x: 30, y: 0, at: 400 },
        { x: 0, y: 0, at: 500 },
        { x: 30, y: 0, at: 600 },
      ],
      expected: 'pet',
    },
  ] as const)('requires the configured direction reversals for $expected', ({ points, expected }) => {
    expect(classifyReleaseIntent(makePetCandidate(
      points.map((point) => ({ ...point })),
    ))).toBe(expected)
  })

  it('ignores non-finite and backwards-time points safely', () => {
    const session = makeSession([{ x: 1, y: 2, at: 10 }])
    const withInvalid = appendGesturePoint(session, { x: Number.NaN, y: 4, at: 11 })
    const withBackwardsTime = appendGesturePoint(withInvalid, { x: 10, y: 10, at: 9 })

    expect(withBackwardsTime).toEqual(session)
    expect(classifyReleaseIntent(makeSession([
      { x: 0, y: 0, at: 10 },
      { x: 20, y: 0, at: 5 },
    ]))).toBe('click')
  })

  it('does not turn a failed pet candidate into a double-click', () => {
    expect(classifyReleaseIntent(makeSession([
      { x: 0, y: 0, at: 400 },
      { x: 1, y: 0, at: 450 },
    ], 200, 'pet-candidate'))).toBeNull()
  })

  it('returns null for a pet candidate with missing cumulative metrics', () => {
    expect(classifyReleaseIntent(makeSession([
      { x: 0, y: 0, at: 350 },
      { x: 30, y: 0, at: 400 },
      { x: 0, y: 0, at: 450 },
      { x: 30, y: 0, at: 500 },
    ], null, 'pet-candidate'))).toBeNull()
  })

  it('retains the original press point when more than 32 points arrive before drag', () => {
    let session = makeSession([{ x: 0, y: 0, at: 0 }])
    for (let index = 1; index <= 40; index += 1) {
      session = appendGesturePoint(session, { x: index / 10, y: 0, at: index })
    }
    session = appendGesturePoint(session, { x: 5, y: 0, at: 100 })

    expect(session.points).toHaveLength(32)
    expect(session.lockedIntent).toBe('drag')
  })

  it('retains the original press time when more than 32 stationary points arrive', () => {
    let session = makeSession([{ x: 0, y: 0, at: 0 }])
    for (let index = 1; index <= 40; index += 1) {
      session = appendGesturePoint(session, { x: 0, y: 0, at: index * 10 })
    }

    expect(session.lockedIntent).toBe('pet-candidate')
  })

  it('does not count movement before entering pet-candidate', () => {
    let session = makeSession([{ x: 0, y: 0, at: 0 }])
    session = appendGesturePoint(session, { x: 4, y: 0, at: 300 })
    session = appendGesturePoint(session, { x: 4, y: 0, at: 350 })
    session = appendGesturePoint(session, { x: 23.75, y: 0, at: 400 })
    session = appendGesturePoint(session, { x: 4, y: 0, at: 450 })
    session = appendGesturePoint(session, { x: 23.75, y: 0, at: 500 })
    session = appendGesturePoint(session, { x: 4, y: 0, at: 550 })

    expect(classifyReleaseIntent(session)).toBeNull()
  })

  it('starts pet metrics at the candidate lock after high-frequency pre-lock jitter', () => {
    let session = makeSession([{ x: 0, y: 0, at: 0 }])
    for (let index = 1; index <= 12; index += 1) {
      session = appendGesturePoint(session, {
        x: index % 2 === 0 ? -4 : 4,
        y: 0,
        at: index * 20,
      })
    }
    session = appendGesturePoint(session, { x: 0, y: 0, at: 350 })

    expect(session).toMatchObject({
      lockedIntent: 'pet-candidate',
      petDistance: 0,
      petTravelX: 0,
      petTravelY: 0,
      petReversalsX: 0,
      petReversalsY: 0,
      petDirectionX: 0,
      petDirectionY: 0,
      petLastPoint: { x: 0, y: 0, at: 350 },
    })
    expect(classifyReleaseIntent(session)).toBeNull()

    session = appendGesturePoint(session, { x: 20, y: 0, at: 400 })
    session = appendGesturePoint(session, { x: -20, y: 0, at: 450 })
    session = appendGesturePoint(session, { x: 20, y: 0, at: 500 })

    expect(session.lockedIntent).toBe('pet')
    expect(classifyReleaseIntent(session)).toBe('pet')
  })

  it('keeps cumulative pet metrics and the pet lock across point truncation', () => {
    let session = makeSession([{ x: 0, y: 0, at: 0 }])
    session = appendGesturePoint(session, { x: 0, y: 0, at: 350 })
    for (let index = 1; index <= 40; index += 1) {
      session = appendGesturePoint(session, {
        x: index % 2 === 0 ? 0 : 3,
        y: 0,
        at: 350 + index,
      })
    }
    session = appendGesturePoint(session, { x: 3, y: 0, at: 500 })

    expect(session.points).toHaveLength(32)
    expect(session.lockedIntent).toBe('pet')
    expect(classifyReleaseIntent(session)).toBe('pet')
  })

  it('uses cumulative axis travel to recognize petting with diagonal drift', () => {
    let session = makeSession([{ x: 0, y: 0, at: 0 }])
    session = appendGesturePoint(session, { x: 0, y: 0, at: 350 })
    session = appendGesturePoint(session, { x: 30, y: 20, at: 400 })
    session = appendGesturePoint(session, { x: 0, y: 40, at: 450 })
    session = appendGesturePoint(session, { x: 30, y: 60, at: 500 })

    expect(classifyReleaseIntent(session)).toBe('pet')
  })

  it('filters time points against the last accepted point', () => {
    expect(classifyReleaseIntent(makeSession([
      { x: 0, y: 0, at: 10 },
      { x: 100, y: 0, at: 5 },
      { x: 1, y: 0, at: 7 },
    ], 0))).toBe('double-click')
  })

  it('corrects a timer-locked candidate to drag using an event at the boundary', () => {
    let session = makeSession([{ x: 0, y: 0, at: 0 }])
    session = appendGesturePoint(session, { x: 0, y: 0, at: 350 })
    session = appendGesturePoint(session, { x: 3, y: 4, at: 350 })

    expect(session.lockedIntent).toBe('drag')
  })

  it('keeps pet-candidate when five pixels are reached after the boundary', () => {
    let session = makeSession([{ x: 0, y: 0, at: 0 }])
    session = appendGesturePoint(session, { x: 0, y: 0, at: 350 })
    session = appendGesturePoint(session, { x: 3, y: 4, at: 351 })

    expect(session.lockedIntent).toBe('pet-candidate')
  })
})
