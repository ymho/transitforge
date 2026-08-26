import type {
  TrainDelaySnapshot,
  TrainOperation,
} from "@raiquora/operation/operation";

export type {
  TrainDelaySnapshot,
  TrainOperation,
} from "@raiquora/operation/operation";

const trainDelayEndpoint = "/api/traffic/delays.json";

export const trainDelayRefreshIntervalMilliseconds = 60 * 1_000;
export const trainDelayRetryIntervalMilliseconds = 15 * 60 * 1_000;

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
  if (Number.isNaN(Date.parse(value.collectedAt))) {
    throw new Error("列車遅延情報の収集日時が不正です。");
  }
  const operationsByTrainNumber = new Map<string, TrainOperation>();
  for (const [trainNumber, rawTrain] of Object.entries(value.trains)) {
    if (
      isRecord(rawTrain) &&
      typeof rawTrain.delayMinutes === "number" &&
      Number.isFinite(rawTrain.delayMinutes) &&
      rawTrain.delayMinutes >= 0 &&
      typeof rawTrain.destination === "string" &&
      Array.isArray(rawTrain.sources) &&
      rawTrain.sources.every((source) => typeof source === "string")
    ) {
      operationsByTrainNumber.set(trainNumber, {
        delayMinutes: rawTrain.delayMinutes,
        destination: rawTrain.destination.trim(),
        sources: rawTrain.sources,
        longTimeStopping: rawTrain.longTimeStopping === true,
      });
    }
  }
  return {
    collectedAt: value.collectedAt,
    failedSources: value.failedSources,
    operationsByTrainNumber,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
