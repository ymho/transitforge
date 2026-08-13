import { advanceRouteTime, type RouteTimeRange } from "./playback";

export interface AnimationScheduler {
  request: (callback: (timestamp: number) => void) => number;
  cancel: (requestId: number) => void;
}

export interface PlaybackControllerOptions {
  initialRouteTime: number;
  range: RouteTimeRange;
  getMinutesPerSecond: () => number;
  render: (routeTimeMinutes: number) => void;
  onOperatingDayWrapped: () => void;
  scheduler?: AnimationScheduler;
  minimumRenderIntervalMilliseconds?: number;
}

export class PlaybackController {
  private readonly scheduler: AnimationScheduler;
  private readonly minimumRenderIntervalMilliseconds: number;
  private routeTime: number;
  private playing = false;
  private requestId: number | undefined;
  private lastTimestamp: number | undefined;
  private lastRenderedTimestamp: number | undefined;

  constructor(private readonly options: PlaybackControllerOptions) {
    this.routeTime = options.initialRouteTime;
    this.minimumRenderIntervalMilliseconds =
      options.minimumRenderIntervalMilliseconds ?? 0;
    this.scheduler = options.scheduler ?? {
      request: (callback) => requestAnimationFrame(callback),
      cancel: (requestId) => cancelAnimationFrame(requestId),
    };
  }

  isPlaying(): boolean {
    return this.playing;
  }

  start(): void {
    if (this.playing) {
      return;
    }
    this.playing = true;
    this.lastTimestamp = undefined;
    this.requestId = this.scheduler.request(this.tick);
  }

  stop(): void {
    this.playing = false;
    this.lastTimestamp = undefined;
    this.lastRenderedTimestamp = undefined;
    if (this.requestId !== undefined) {
      this.scheduler.cancel(this.requestId);
      this.requestId = undefined;
    }
  }

  seek(routeTimeMinutes: number, render = true): void {
    this.routeTime = routeTimeMinutes;
    if (render) {
      this.options.render(routeTimeMinutes);
    }
  }

  private readonly tick = (timestamp: number): void => {
    if (!this.playing) {
      return;
    }
    if (this.lastTimestamp !== undefined) {
      const nextRouteTime = advanceRouteTime(
        this.routeTime,
        timestamp - this.lastTimestamp,
        this.options.getMinutesPerSecond(),
        this.options.range,
      );
      if (nextRouteTime < this.routeTime) {
        this.options.onOperatingDayWrapped();
      }
      this.routeTime = nextRouteTime;
      if (
        this.lastRenderedTimestamp === undefined ||
        timestamp - this.lastRenderedTimestamp >=
          this.minimumRenderIntervalMilliseconds
      ) {
        this.options.render(this.routeTime);
        this.lastRenderedTimestamp = timestamp;
      }
    }
    this.lastTimestamp = timestamp;
    this.requestId = this.scheduler.request(this.tick);
  };
}
