import type {
  DailyCongestionAnalysisResponse,
  TrainCongestionStat,
} from "@raiquora/operation/analysis";
import type { Train } from "@raiquora/train/train";

export interface CongestionTrainAnalysis {
  trainNumber: string;
  serviceType: string;
  trainName: string;
  destination: string;
  lineName: string;
  observedSampleCount: number;
  averageCongestion: number;
  dailyAverageContribution: number;
  peakCongestion: number;
  peakCollectedAt: string;
}

export interface CongestionLineAnalysis {
  lineName: string;
  averageTotalCongestion: number;
  trainCount: number;
}

export interface CongestionAnalysisForAgent {
  serviceDate: string;
  sampleCount: number;
  observationStart: string | null;
  observationEnd: string | null;
  peak: {
    collectedAt: string;
    totalCongestion: number;
    trainCount: number;
    carCount: number;
    topTrains: CongestionTrainAnalysis[];
  } | null;
  hourly: Array<{
    hourJst: number;
    sampleCount: number;
    averageTotalCongestion: number | null;
    peakTotalCongestion: number | null;
    peakCollectedAt: string | null;
    averageTrainCount: number | null;
  }>;
  topLines: CongestionLineAnalysis[];
  topTrains: CongestionTrainAnalysis[];
  unmatchedTrainCount: number;
}

export function congestionAnalysisForAgent(
  analysis: DailyCongestionAnalysisResponse,
  trains: Train[],
  lineNameForTrain: (train: Train) => string,
): CongestionAnalysisForAgent {
  const trainsByNumber = groupTrainsByNumber(trains);
  const enrichedStats = analysis.trainStats.map((stat) =>
    enrichTrainStat(stat, trainsByNumber, lineNameForTrain),
  );
  const lineStats = new Map<
    string,
    { averageTotalCongestion: number; trainNumbers: Set<string> }
  >();

  for (const train of enrichedStats) {
    if (train.lineName === "路線未判定") {
      continue;
    }
    const line = lineStats.get(train.lineName) ?? {
      averageTotalCongestion: 0,
      trainNumbers: new Set<string>(),
    };
    line.averageTotalCongestion += train.dailyAverageContribution;
    line.trainNumbers.add(train.trainNumber);
    lineStats.set(train.lineName, line);
  }

  return {
    serviceDate: analysis.serviceDate,
    sampleCount: analysis.sampleCount,
    observationStart: analysis.observationStart,
    observationEnd: analysis.observationEnd,
    peak:
      analysis.peak === null
        ? null
        : {
            collectedAt: analysis.peak.collectedAt,
            totalCongestion: analysis.peak.totalCongestion,
            trainCount: analysis.peak.trainCount,
            carCount: analysis.peak.carCount,
            topTrains: analysis.peak.topTrains.map((train) =>
              enrichTrainStat(
                {
                  trainNumber: train.trainNumber,
                  observedSampleCount: 1,
                  averageCongestion: train.totalCongestion,
                  dailyAverageContribution: train.totalCongestion,
                  peakCongestion: train.totalCongestion,
                  peakCollectedAt: analysis.peak?.collectedAt ?? "",
                },
                trainsByNumber,
                lineNameForTrain,
              ),
            ),
          },
    hourly: analysis.hourly.map(
      ({ topTrain: _, ...hourly }) => hourly,
    ),
    topLines: Array.from(lineStats, ([lineName, line]) => ({
      lineName,
      averageTotalCongestion: roundToTwoDecimals(
        line.averageTotalCongestion,
      ),
      trainCount: line.trainNumbers.size,
    }))
      .sort(
        (left, right) =>
          right.averageTotalCongestion - left.averageTotalCongestion ||
          left.lineName.localeCompare(right.lineName, "ja"),
      )
      .slice(0, 5),
    topTrains: enrichedStats
      .sort(
        (left, right) =>
          right.averageCongestion - left.averageCongestion ||
          right.peakCongestion - left.peakCongestion ||
          left.trainNumber.localeCompare(right.trainNumber, "ja"),
      )
      .slice(0, 5),
    unmatchedTrainCount: enrichedStats.filter(
      ({ serviceType, lineName }) =>
        serviceType === "不明" || lineName === "路線未判定",
    ).length,
  };
}

function enrichTrainStat(
  stat: TrainCongestionStat,
  trainsByNumber: ReadonlyMap<string, Train[]>,
  lineNameForTrain: (train: Train) => string,
): CongestionTrainAnalysis {
  const train = trainAtCollectedTime(
    trainsByNumber.get(stat.trainNumber) ?? [],
    stat.peakCollectedAt,
  );
  return {
    trainNumber: stat.trainNumber,
    serviceType: train?.service_type || "不明",
    trainName: train?.train_name ?? "",
    destination: train?.destination_station || "不明",
    lineName: train ? lineNameForTrain(train) : "路線未判定",
    observedSampleCount: stat.observedSampleCount,
    averageCongestion: stat.averageCongestion,
    dailyAverageContribution: stat.dailyAverageContribution,
    peakCongestion: stat.peakCongestion,
    peakCollectedAt: stat.peakCollectedAt,
  };
}

function groupTrainsByNumber(trains: Train[]): Map<string, Train[]> {
  const trainsByNumber = new Map<string, Train[]>();
  for (const train of trains) {
    const matching = trainsByNumber.get(train.train_no) ?? [];
    matching.push(train);
    trainsByNumber.set(train.train_no, matching);
  }
  return trainsByNumber;
}

function trainAtCollectedTime(
  candidates: Train[],
  collectedAt: string,
): Train | undefined {
  if (candidates.length <= 1) {
    return candidates[0];
  }
  const routeTimeMinutes = routeTimeMinutesInJapan(collectedAt);
  if (routeTimeMinutes === undefined) {
    return candidates[0];
  }
  const routeTimeCandidates = [routeTimeMinutes, routeTimeMinutes + 24 * 60];
  return (
    candidates.find((train) => {
      const range = trainRouteTimeRange(train);
      return (
        range !== undefined &&
        routeTimeCandidates.some(
          (time) => time >= range.start && time <= range.end,
        )
      );
    }) ?? candidates[0]
  );
}

function trainRouteTimeRange(
  train: Train,
): { start: number; end: number } | undefined {
  const times = train.stops.flatMap(({ route_time_minutes }) =>
    route_time_minutes === undefined ? [] : [route_time_minutes],
  );
  return times.length === 0
    ? undefined
    : { start: Math.min(...times), end: Math.max(...times) };
}

function routeTimeMinutesInJapan(collectedAt: string): number | undefined {
  const date = new Date(collectedAt);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  const hour = Number(byType.get("hour"));
  const minute = Number(byType.get("minute"));
  return Number.isFinite(hour) && Number.isFinite(minute)
    ? hour * 60 + minute
    : undefined;
}

function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}
