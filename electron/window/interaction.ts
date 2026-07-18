export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export interface Rectangle extends Point, Size {}

export type WindowMode = 'auth' | 'collapsed' | 'expanded'

export const WINDOW_SIZES: Readonly<Record<WindowMode, Readonly<Size>>> = {
  auth: { width: 380, height: 430 },
  collapsed: { width: 180, height: 190 },
  expanded: { width: 380, height: 430 },
}

export function clampWindowPosition(
  position: Point,
  size: Size,
  workArea: Rectangle,
): Point {
  const maxX = workArea.x + workArea.width - size.width
  const maxY = workArea.y + workArea.height - size.height

  return {
    x: size.width > workArea.width
      ? workArea.x
      : Math.min(Math.max(position.x, workArea.x), maxX),
    y: size.height > workArea.height
      ? workArea.y
      : Math.min(Math.max(position.y, workArea.y), maxY),
  }
}

export function anchoredBottomCenterBounds(
  oldBounds: Rectangle,
  newSize: Size,
  workArea: Rectangle,
): Rectangle {
  const position = clampWindowPosition({
    x: Math.round(oldBounds.x + oldBounds.width / 2 - newSize.width / 2),
    y: oldBounds.y + oldBounds.height - newSize.height,
  }, newSize, workArea)

  return { ...position, ...newSize }
}

export function isRectangleCoveredByWorkAreas(
  rectangle: Rectangle,
  workAreas: readonly Rectangle[],
): boolean {
  if (rectangle.width <= 0 || rectangle.height <= 0) return false

  const left = rectangle.x
  const right = rectangle.x + rectangle.width
  const top = rectangle.y
  const bottom = rectangle.y + rectangle.height
  const relevantAreas = workAreas.filter((area) =>
    area.width > 0
    && area.height > 0
    && area.x < right
    && area.x + area.width > left
    && area.y < bottom
    && area.y + area.height > top)
  const xBoundaries = new Set<number>([left, right])
  for (const area of relevantAreas) {
    xBoundaries.add(Math.max(left, area.x))
    xBoundaries.add(Math.min(right, area.x + area.width))
  }
  const sortedX = [...xBoundaries].sort((a, b) => a - b)

  for (let index = 0; index < sortedX.length - 1; index += 1) {
    const sliceLeft = sortedX[index]
    const sliceRight = sortedX[index + 1]
    if (sliceLeft === sliceRight) continue

    const yIntervals = relevantAreas
      .filter((area) => area.x <= sliceLeft && area.x + area.width >= sliceRight)
      .map((area) => [
        Math.max(top, area.y),
        Math.min(bottom, area.y + area.height),
      ] as const)
      .sort((a, b) => a[0] - b[0])
    let coveredUntil = top
    for (const [intervalTop, intervalBottom] of yIntervals) {
      if (intervalTop > coveredUntil) break
      coveredUntil = Math.max(coveredUntil, intervalBottom)
      if (coveredUntil >= bottom) break
    }
    if (coveredUntil < bottom) return false
  }

  return true
}
