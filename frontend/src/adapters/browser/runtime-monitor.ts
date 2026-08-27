import type { RuntimeMetrics } from "../../observability/runtime-metrics";

export interface RuntimeMonitorEnvironment {
  now(): number;
  requestFrame(callback: (timestamp: number) => void): void;
  heapBytes(): number | undefined;
  debug(message: string, value: object): void;
}

export interface RuntimeMonitor {
  start(): void;
  log(): void;
}

const logIntervalMilliseconds = 10_000;

export function createRuntimeMonitor(
  metrics: RuntimeMetrics,
  environment: RuntimeMonitorEnvironment = browserRuntimeMonitorEnvironment(),
): RuntimeMonitor {
  let nextLogTimestamp = 0;
  let started = false;
  const log = () => {
    const now = environment.now();
    if (now < nextLogTimestamp) return;
    nextLogTimestamp = now + logIntervalMilliseconds;
    environment.debug("[Raiquora] runtime metrics", {
      ...metrics.getSnapshot(),
      usedJsHeap: formatHeapUsage(environment.heapBytes()),
    });
  };
  return {
    start() {
      if (started) return;
      started = true;
      let previousTimestamp: number | undefined;
      let nextRenderTimestamp = 0;
      const record = (timestamp: number) => {
        if (previousTimestamp !== undefined) {
          metrics.recordFrame(timestamp - previousTimestamp);
          if (timestamp >= nextRenderTimestamp) {
            log();
            nextRenderTimestamp = timestamp + 500;
          }
        }
        previousTimestamp = timestamp;
        environment.requestFrame(record);
      };
      environment.requestFrame(record);
    },
    log,
  };
}

export function nextBrowserFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export function formatHeapUsage(bytes: number | undefined): string {
  return bytes === undefined ? "未対応" : `${(bytes / 1_048_576).toFixed(0)} MiB`;
}

function browserRuntimeMonitorEnvironment(): RuntimeMonitorEnvironment {
  return {
    now: () => performance.now(),
    requestFrame: (callback) => requestAnimationFrame(callback),
    heapBytes: () =>
      (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
        ?.usedJSHeapSize,
    debug: (message, value) => console.debug(message, value),
  };
}
