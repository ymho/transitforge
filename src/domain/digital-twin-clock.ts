export interface DigitalTwinClockEnvironment {
  now(): Date;
  isVisible(): boolean;
  subscribeToActivation(callback: () => void): () => void;
}

export interface DigitalTwinClockSynchronizer {
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

export function createDigitalTwinClockSynchronizer(
  synchronize: (now: Date) => void,
  environment: DigitalTwinClockEnvironment,
): DigitalTwinClockSynchronizer {
  let enabled = false;
  let disposed = false;

  const synchronizeIfActive = () => {
    if (!disposed && enabled && environment.isVisible()) {
      synchronize(environment.now());
    }
  };
  const unsubscribe = environment.subscribeToActivation(synchronizeIfActive);

  return {
    setEnabled(nextEnabled) {
      if (disposed || nextEnabled === enabled) return;
      enabled = nextEnabled;
      synchronizeIfActive();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
    },
  };
}

export function browserDigitalTwinClockEnvironment(): DigitalTwinClockEnvironment {
  return {
    now: () => new Date(),
    isVisible: () => document.visibilityState === "visible",
    subscribeToActivation(callback) {
      const onVisibilityChange = () => {
        if (document.visibilityState === "visible") callback();
      };
      document.addEventListener("visibilitychange", onVisibilityChange);
      window.addEventListener("focus", callback);
      window.addEventListener("pageshow", callback);
      return () => {
        document.removeEventListener("visibilitychange", onVisibilityChange);
        window.removeEventListener("focus", callback);
        window.removeEventListener("pageshow", callback);
      };
    },
  };
}
