const hazeStart = 0.18;
const hazeEnd = 0.92;
const maximumHazeMix = 0.9;

export function weatherHazeMixAtViewportPoint(
  point: { x: number; y: number },
  viewport: { width: number; height: number },
): number {
  if (viewport.width <= 0 || viewport.height <= 0) {
    return 0;
  }

  const normalizedX = (point.x - viewport.width / 2) / (viewport.width / 2);
  const normalizedY = (point.y - viewport.height / 2) / (viewport.height / 2);
  const normalizedDistance = Math.hypot(normalizedX, normalizedY);
  const progress = Math.min(
    Math.max((normalizedDistance - hazeStart) / (hazeEnd - hazeStart), 0),
    1,
  );
  const smoothed = progress * progress * (3 - 2 * progress);
  return smoothed * maximumHazeMix;
}
