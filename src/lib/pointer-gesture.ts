export interface Point {
  x: number
  y: number
}

export type Gesture = 'click' | 'drag'

export function classifyGesture(start: Point, end: Point, threshold: number): Gesture {
  if (!Number.isFinite(threshold) || threshold < 0) {
    throw new RangeError('Gesture threshold must be a finite non-negative number')
  }

  return Math.hypot(end.x - start.x, end.y - start.y) >= threshold
    ? 'drag'
    : 'click'
}
