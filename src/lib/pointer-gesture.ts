export interface Point {
  x: number
  y: number
}

export type Gesture = 'click' | 'drag'

export type PointerIntent = 'click' | 'double-click' | 'drag' | 'pet'

export interface GesturePoint extends Point {
  at: number
}

export interface GestureSession {
  points: GesturePoint[]
  previousClickAt: number | null
  lockedIntent: 'drag' | 'pet-candidate' | 'pet' | null
  origin?: GesturePoint
  petDistance?: number
  petTravelX?: number
  petTravelY?: number
  petReversalsX?: number
  petReversalsY?: number
  petDirectionX?: number
  petDirectionY?: number
  petLastPoint?: GesturePoint
}

const DRAG_THRESHOLD = 5
const HOLD_DURATION_MS = 350
const DOUBLE_CLICK_INTERVAL_MS = 300
const PET_DISTANCE = 80
const PET_REVERSALS = 2
const MAX_POINTS = 32

export function classifyGesture(start: Point, end: Point, threshold: number): Gesture {
  if (!Number.isFinite(threshold) || threshold < 0) {
    throw new RangeError('Gesture threshold must be a finite non-negative number')
  }

  return Math.hypot(end.x - start.x, end.y - start.y) >= threshold
    ? 'drag'
    : 'click'
}

function isValidPoint(point: GesturePoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.at)
}

export function appendGesturePoint(
  session: GestureSession,
  point: GesturePoint,
): GestureSession {
  const lastPoint = session.points[session.points.length - 1]
  if (!isValidPoint(point) || (lastPoint && point.at < lastPoint.at)) return session

  const points = [...session.points, point].slice(-MAX_POINTS)
  const origin = session.origin ?? session.points.find(isValidPoint) ?? point
  if (session.lockedIntent === 'drag' || session.lockedIntent === 'pet') {
    return { ...session, origin, points }
  }

  const elapsed = point.at - origin.at
  const displacement = Math.hypot(point.x - origin.x, point.y - origin.y)
  let lockedIntent: GestureSession['lockedIntent'] = session.lockedIntent
  if (lockedIntent === 'pet-candidate'
    && elapsed <= HOLD_DURATION_MS
    && displacement >= DRAG_THRESHOLD) {
    return { ...session, origin, points, lockedIntent: 'drag' }
  }

  if (lockedIntent === 'pet-candidate') {
    const petLastPoint = session.petLastPoint ?? lastPoint ?? point
    const deltaX = point.x - petLastPoint.x
    const deltaY = point.y - petLastPoint.y
    const directionX = Math.sign(deltaX)
    const directionY = Math.sign(deltaY)
    const previousDirectionX = session.petDirectionX ?? 0
    const previousDirectionY = session.petDirectionY ?? 0
    const petDistance = (session.petDistance ?? 0) + Math.hypot(deltaX, deltaY)
    const petTravelX = (session.petTravelX ?? 0) + Math.abs(deltaX)
    const petTravelY = (session.petTravelY ?? 0) + Math.abs(deltaY)
    const petReversalsX = (session.petReversalsX ?? 0)
      + Number(directionX !== 0 && previousDirectionX !== 0 && directionX !== previousDirectionX)
    const petReversalsY = (session.petReversalsY ?? 0)
      + Number(directionY !== 0 && previousDirectionY !== 0 && directionY !== previousDirectionY)
    const reversals = petTravelX >= petTravelY ? petReversalsX : petReversalsY
    if (petDistance >= PET_DISTANCE && reversals >= PET_REVERSALS) lockedIntent = 'pet'

    return {
      ...session,
      origin,
      points,
      lockedIntent,
      petDistance,
      petTravelX,
      petTravelY,
      petReversalsX,
      petReversalsY,
      petDirectionX: directionX || previousDirectionX,
      petDirectionY: directionY || previousDirectionY,
      petLastPoint: point,
    }
  }

  if (elapsed <= HOLD_DURATION_MS && displacement >= DRAG_THRESHOLD) {
    lockedIntent = 'drag'
  } else if (elapsed >= HOLD_DURATION_MS && displacement < DRAG_THRESHOLD) {
    lockedIntent = 'pet-candidate'
  }

  return {
    ...session,
    origin,
    points,
    lockedIntent,
    ...(lockedIntent === 'pet-candidate' ? {
      petDistance: 0,
      petTravelX: 0,
      petTravelY: 0,
      petReversalsX: 0,
      petReversalsY: 0,
      petDirectionX: 0,
      petDirectionY: 0,
      petLastPoint: point,
    } : {}),
  }
}

function validTimeOrderedPoints(points: GesturePoint[]): GesturePoint[] {
  const accepted: GesturePoint[] = []
  for (const point of points) {
    const lastAccepted = accepted[accepted.length - 1]
    if (isValidPoint(point) && (!lastAccepted || point.at >= lastAccepted.at)) accepted.push(point)
  }
  return accepted
}

export function classifyReleaseIntent(session: GestureSession): PointerIntent | null {
  if (session.lockedIntent === 'drag') return 'drag'
  if (session.lockedIntent === 'pet') return 'pet'

  const points = validTimeOrderedPoints(session.points)
  if (session.lockedIntent === 'pet-candidate') {
    if (session.petDistance === undefined
      || session.petTravelX === undefined
      || session.petTravelY === undefined
      || session.petReversalsX === undefined
      || session.petReversalsY === undefined) return null
    const reversals = session.petTravelX >= session.petTravelY
      ? session.petReversalsX
      : session.petReversalsY
    return session.petDistance >= PET_DISTANCE && reversals >= PET_REVERSALS ? 'pet' : null
  }

  const releasedAt = points[points.length - 1]?.at
  if (releasedAt !== undefined
    && session.previousClickAt !== null
    && releasedAt >= session.previousClickAt
    && releasedAt - session.previousClickAt <= DOUBLE_CLICK_INTERVAL_MS) {
    return 'double-click'
  }
  return 'click'
}
