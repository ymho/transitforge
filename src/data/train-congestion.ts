const congestionEndpoint = "/api/westjr/trainmonitorinfo.json";

export const congestionRefreshIntervalMilliseconds = 60 * 1_000;
export const congestionRetryIntervalMilliseconds = 15 * 60 * 1_000;

export interface TrainCongestionSnapshot {
  updatedAt: string;
  byTrainNumber: ReadonlyMap<string, number>;
}

export async function loadTrainCongestion(
  signal?: AbortSignal,
): Promise<TrainCongestionSnapshot> {
  const response = await fetch(congestionEndpoint, {
    signal,
    cache: "default",
  });
  if (!response.ok) {
    throw new Error(`列車混雑情報を読み込めませんでした (${response.status})。`);
  }

  return parseTrainCongestion(await response.json());
}

export function parseTrainCongestion(value: unknown): TrainCongestionSnapshot {
  if (
    !isRecord(value) ||
    typeof value.update !== "string" ||
    !isRecord(value.trains)
  ) {
    throw new Error("列車混雑情報の形式が不正です。");
  }

  const byTrainNumber = new Map<string, number>();
  for (const [trainNumber, rawConsists] of Object.entries(value.trains)) {
    if (!Array.isArray(rawConsists)) {
      continue;
    }

    const congestionValues: number[] = [];
    for (const rawConsist of rawConsists) {
      if (!isRecord(rawConsist) || !Array.isArray(rawConsist.cars)) {
        continue;
      }
      for (const rawCar of rawConsist.cars) {
        if (
          isRecord(rawCar) &&
          typeof rawCar.congestion === "number" &&
          Number.isFinite(rawCar.congestion) &&
          rawCar.congestion >= 0
        ) {
          congestionValues.push(rawCar.congestion);
        }
      }
    }

    if (congestionValues.length > 0) {
      byTrainNumber.set(
        trainNumber,
        congestionValues.reduce((sum, congestion) => sum + congestion, 0),
      );
    }
  }

  return {
    updatedAt: value.update,
    byTrainNumber,
  };
}

export function congestionBarHeightMeters(congestion: number): number {
  return Math.max(congestion, 0) * 0.1;
}

export function congestionBarColor(congestion: number): string {
  if (congestion <= 300) {
    return "#38b56b";
  }
  if (congestion <= 600) {
    return "#f0c94d";
  }
  if (congestion <= 900) {
    return "#df4851";
  }
  return "#6d3fb3";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
