const trainDelayEndpoint = "/api/traffic/delays.json";

export const trainDelayRefreshIntervalMilliseconds = 60 * 1_000;
export const trainDelayRetryIntervalMilliseconds = 15 * 60 * 1_000;

export interface TrainDelaySnapshot {
  collectedAt: string;
  failedSources: string[];
  byTrainNumber: ReadonlyMap<string, number>;
}

export async function loadTrainDelays(
  signal?: AbortSignal,
): Promise<TrainDelaySnapshot> {
  const response = await fetch(trainDelayEndpoint, {
    signal,
    cache: "default",
  });
  if (!response.ok) {
    throw new Error(`列車遅延情報を読み込めませんでした (${response.status})。`);
  }
  return parseTrainDelays(await response.json());
}

export function parseTrainDelays(value: unknown): TrainDelaySnapshot {
  if (
    !isRecord(value) ||
    typeof value.collectedAt !== "string" ||
    !Array.isArray(value.failedSources) ||
    !value.failedSources.every((source) => typeof source === "string") ||
    !isRecord(value.trains)
  ) {
    throw new Error("列車遅延情報の形式が不正です。");
  }
  const byTrainNumber = new Map<string, number>();
  for (const [trainNumber, rawTrain] of Object.entries(value.trains)) {
    if (
      isRecord(rawTrain) &&
      typeof rawTrain.delayMinutes === "number" &&
      Number.isFinite(rawTrain.delayMinutes) &&
      rawTrain.delayMinutes >= 0
    ) {
      byTrainNumber.set(trainNumber, rawTrain.delayMinutes);
    }
  }
  return {
    collectedAt: value.collectedAt,
    failedSources: value.failedSources,
    byTrainNumber,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
