/** Only worker-backed hit data is throttled; train rendering remains unchanged. */
export class TrainHitUpdateSchedule {
  private lastUpdate = -Infinity;
  shouldUpdate(now: number): boolean {
    if (now - this.lastUpdate < 100) return false;
    this.lastUpdate = now;
    return true;
  }
}

export function nearestTrainHit(
  targets: ReadonlyArray<{ serviceUid: string; point: { x: number; y: number } }>,
  point: { x: number; y: number },
): string | undefined {
  let nearest: string | undefined;
  let distanceSquared = 22 ** 2;
  for (const target of targets) {
    const distance = (target.point.x - point.x) ** 2 + (target.point.y - point.y) ** 2;
    if (distance <= distanceSquared) {
      distanceSquared = distance;
      nearest = target.serviceUid;
    }
  }
  return nearest;
}
