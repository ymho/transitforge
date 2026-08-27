export interface ScreenPoint { x: number; y: number }

export function distanceToScreenSegment(
  point: ScreenPoint,
  start: ScreenPoint,
  end: ScreenPoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const progress = Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
  ));
  return Math.hypot(point.x - (start.x + progress * dx), point.y - (start.y + progress * dy));
}
