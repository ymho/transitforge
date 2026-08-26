export interface PollingEnvironment {
  now(): number;
  isVisible(): boolean;
  setTimer(callback: () => void, delayMilliseconds: number): unknown;
  clearTimer(timer: unknown): void;
  subscribeToVisibilityChange(callback: () => void): () => void;
}

export interface PollingController {
  setEnabled(enabled: boolean): void;
  refreshNow(): Promise<void>;
  dispose(): void;
}

export interface PollingOptions<T> {
  load(): Promise<T>;
  apply(value: T): void;
  onError(error: unknown): void;
  refreshIntervalMilliseconds: number;
  retryIntervalMilliseconds: number;
  initiallyEnabled?: boolean;
}

export function createPollingController<T>(
  options: PollingOptions<T>,
  environment: PollingEnvironment,
): PollingController {
  let enabled = options.initiallyEnabled ?? true;
  let refreshing = false;
  let disposed = false;
  let timer: unknown;
  let nextRefreshAt = environment.now();

  const clearScheduledRefresh = () => {
    if (timer !== undefined) {
      environment.clearTimer(timer);
      timer = undefined;
    }
  };
  const canRefresh = () => !disposed && enabled && environment.isVisible();
  const schedule = (delayMilliseconds: number) => {
    clearScheduledRefresh();
    const delay = Math.max(0, delayMilliseconds);
    nextRefreshAt = environment.now() + delay;
    if (canRefresh()) {
      timer = environment.setTimer(() => {
        timer = undefined;
        void refreshNow();
      }, delay);
    }
  };
  const refreshNow = async () => {
    if (!canRefresh() || refreshing) return;
    refreshing = true;
    try {
      const value = await options.load();
      if (disposed) return;
      options.apply(value);
      schedule(options.refreshIntervalMilliseconds);
    } catch (error) {
      if (disposed) return;
      options.onError(error);
      schedule(options.retryIntervalMilliseconds);
    } finally {
      refreshing = false;
    }
  };
  const setEnabled = (nextEnabled: boolean) => {
    if (disposed) return;
    enabled = nextEnabled;
    if (!enabled) {
      clearScheduledRefresh();
      return;
    }
    schedule(Math.max(0, nextRefreshAt - environment.now()));
  };
  const unsubscribe = environment.subscribeToVisibilityChange(() => {
    if (!canRefresh()) {
      clearScheduledRefresh();
      return;
    }
    schedule(Math.max(0, nextRefreshAt - environment.now()));
  });

  void refreshNow();
  return {
    setEnabled,
    refreshNow,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      clearScheduledRefresh();
      unsubscribe();
    },
  };
}
