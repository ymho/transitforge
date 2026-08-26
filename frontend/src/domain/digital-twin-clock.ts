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
