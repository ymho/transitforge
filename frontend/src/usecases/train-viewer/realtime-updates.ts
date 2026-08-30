import {
  createPollingController,
  type PollingEnvironment,
} from "../polling-controller";
import type {
  TrainCongestionSnapshot,
  TrainDelaySnapshot,
} from "@raiquora/operation/operation";

export interface RealtimeVisualizationController {
  setEnabled(enabled: boolean): void;
  setAvailable(available: boolean): void;
  dispose(): void;
}

export interface CongestionLayer {
  setCongestionByTrainNumber(values: ReadonlyMap<string, number>): void;
  setCongestionVisible(visible: boolean): void;
}

export interface RealtimeUpdateDependencies {
  pollingEnvironment(): PollingEnvironment;
  loadCongestion(): Promise<TrainCongestionSnapshot>;
  congestionRefreshIntervalMilliseconds: number;
  congestionRetryIntervalMilliseconds: number;
  loadDelays(): Promise<TrainDelaySnapshot>;
  delayRefreshIntervalMilliseconds: number;
  delayRetryIntervalMilliseconds: number;
}

export function configureTrainCongestionUpdates(
  trainLayer: CongestionLayer,
  toggle: HTMLButtonElement,
  dependencies: RealtimeUpdateDependencies,
): RealtimeVisualizationController {
  let requested = true;
  let available = false;
  const poller = createPollingController(
    {
      load: dependencies.loadCongestion,
      apply: (snapshot) => {
        trainLayer.setCongestionByTrainNumber(snapshot.byTrainNumber);
      },
      onError: (error) =>
        console.warn("列車混雑情報を更新できませんでした。", error),
      refreshIntervalMilliseconds: dependencies.congestionRefreshIntervalMilliseconds,
      retryIntervalMilliseconds: dependencies.congestionRetryIntervalMilliseconds,
    },
    dependencies.pollingEnvironment(),
  );

  const apply = () => {
    const visible = available && requested;
    toggle.disabled = !available;
    toggle.ariaPressed = String(visible);
    toggle.title = available ? "混雑表示" : "現在運行状況で利用可能";
    toggle.ariaLabel = available
      ? "混雑表示"
      : "混雑表示は現在運行状況で利用可能";
    trainLayer.setCongestionVisible(visible);
    poller.setEnabled(visible);
  };
  const setEnabled = (nextEnabled: boolean) => {
    requested = nextEnabled;
    apply();
  };
  const handleToggle = () => setEnabled(!requested);
  toggle.addEventListener("click", handleToggle);
  apply();

  return {
    setEnabled,
    setAvailable: (nextAvailable) => {
      available = nextAvailable;
      apply();
    },
    dispose: () => {
      toggle.removeEventListener("click", handleToggle);
      poller.dispose();
    },
  };
}

export function configureTrainDelayUpdates(
  onUpdate: (snapshot: TrainDelaySnapshot) => void,
  dependencies: RealtimeUpdateDependencies,
): () => void {
  const poller = createPollingController(
    {
      load: dependencies.loadDelays,
      apply: (snapshot) => {
        if (snapshot.failedSources.length > 0) {
          console.warn(
            "[Raiquora] 遅延スナップショットが不完全なため日時指定表示を維持します。",
            {
              collectedAt: snapshot.collectedAt,
              failedSources: snapshot.failedSources,
            },
          );
          return;
        }
        onUpdate(snapshot);
      },
      onError: (error) =>
        console.warn("列車遅延情報を更新できませんでした。", error),
      refreshIntervalMilliseconds: dependencies.delayRefreshIntervalMilliseconds,
      retryIntervalMilliseconds: dependencies.delayRetryIntervalMilliseconds,
    },
    dependencies.pollingEnvironment(),
  );
  return poller.dispose;
}
