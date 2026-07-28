export interface RuntimeMetricsSnapshot {
  routeLoadMilliseconds?: number;
  trainLoadMilliseconds?: number;
  positionUpdateMilliseconds?: number;
  activeTrainCount: number;
  framesPerSecond?: number;
  averageFrameMilliseconds?: number;
}

export class RuntimeMetrics {
  private readonly frameDurations: number[] = [];
  private snapshot: RuntimeMetricsSnapshot = { activeTrainCount: 0 };

  recordRouteLoad(milliseconds: number): void {
    this.snapshot.routeLoadMilliseconds = milliseconds;
  }

  recordTrainLoad(milliseconds: number): void {
    this.snapshot.trainLoadMilliseconds = milliseconds;
  }

  recordPositionUpdate(milliseconds: number, activeTrainCount: number): void {
    this.snapshot.positionUpdateMilliseconds = milliseconds;
    this.snapshot.activeTrainCount = activeTrainCount;
  }

  recordFrame(milliseconds: number): void {
    this.frameDurations.push(milliseconds);
    if (this.frameDurations.length > 120) {
      this.frameDurations.shift();
    }

    const total = this.frameDurations.reduce((sum, duration) => sum + duration, 0);
    const average = total / this.frameDurations.length;
    this.snapshot.averageFrameMilliseconds = average;
    this.snapshot.framesPerSecond = average === 0 ? undefined : 1_000 / average;
  }

  getSnapshot(): RuntimeMetricsSnapshot {
    return { ...this.snapshot };
  }
}
