import type {
  TrainDelayAnalysisResponse,
  TrainDelaySnapshotAnalysis,
  TrainDelayStat,
} from "./operations/analysis";
import type { Train } from "./rail/train";

export interface DelayTrainForAgent {
  trainNumber: string;
  serviceType: string;
  trainName: string;
  destination: string;
  delayedSampleCount?: number;
  averageDelayWhenDelayed?: number;
  dailyAverageDelayContribution?: number;
  delayMinutes?: number;
  peakDelayMinutes?: number;
  peakCollectedAt?: string;
}

export interface DelayAnalysisForAgent {
  serviceDate: string;
  sampleCount: number;
  observationStart: string | null;
  observationEnd: string | null;
  latest: EnrichedDelaySnapshot | null;
  peak: EnrichedDelaySnapshot | null;
  hourly: TrainDelayAnalysisResponse["hourly"];
  topTrains: DelayTrainForAgent[];
  unmatchedTrainCount: number;
}

interface EnrichedDelaySnapshot
  extends Omit<TrainDelaySnapshotAnalysis, "topTrains"> {
  topTrains: DelayTrainForAgent[];
}

export function delayAnalysisForAgent(
  analysis: TrainDelayAnalysisResponse,
  trains: Train[],
): DelayAnalysisForAgent {
  const trainsByNumber = new Map<string, Train[]>();
  for (const train of trains) {
    const matches = trainsByNumber.get(train.train_no) ?? [];
    matches.push(train);
    trainsByNumber.set(train.train_no, matches);
  }
  const topStats = [...analysis.trainStats]
    .sort(
      (left, right) =>
        right.peakDelayMinutes - left.peakDelayMinutes ||
        right.delayedSampleCount - left.delayedSampleCount ||
        left.trainNumber.localeCompare(right.trainNumber, "ja"),
    )
    .slice(0, 5);
  return {
    serviceDate: analysis.serviceDate,
    sampleCount: analysis.sampleCount,
    observationStart: analysis.observationStart,
    observationEnd: analysis.observationEnd,
    latest: enrichSnapshot(analysis.latest, trainsByNumber),
    peak: enrichSnapshot(analysis.peak, trainsByNumber),
    hourly: analysis.hourly,
    topTrains: topStats.map((stat) => enrichStat(stat, trainsByNumber)),
    unmatchedTrainCount: analysis.trainStats.filter(
      (stat) => !trainsByNumber.has(stat.trainNumber),
    ).length,
  };
}

function enrichSnapshot(
  snapshot: TrainDelaySnapshotAnalysis | null,
  trainsByNumber: ReadonlyMap<string, Train[]>,
): EnrichedDelaySnapshot | null {
  if (snapshot === null) {
    return null;
  }
  return {
    ...snapshot,
    topTrains: snapshot.topTrains.slice(0, 5).map((item) => {
      const train = trainAtTime(
        trainsByNumber.get(item.trainNumber) ?? [],
        snapshot.collectedAt,
      );
      return {
        trainNumber: item.trainNumber,
        serviceType: train?.service_type || "不明",
        trainName: train?.train_name ?? "",
        destination: train?.destination_station || "不明",
        delayMinutes: item.delayMinutes,
      };
    }),
  };
}

function enrichStat(
  stat: TrainDelayStat,
  trainsByNumber: ReadonlyMap<string, Train[]>,
): DelayTrainForAgent {
  const train = trainAtTime(
    trainsByNumber.get(stat.trainNumber) ?? [],
    stat.peakCollectedAt,
  );
  return {
    trainNumber: stat.trainNumber,
    serviceType: train?.service_type || "不明",
    trainName: train?.train_name ?? "",
    destination: train?.destination_station || "不明",
    delayedSampleCount: stat.delayedSampleCount,
    averageDelayWhenDelayed: stat.averageDelayWhenDelayed,
    dailyAverageDelayContribution: stat.dailyAverageDelayContribution,
    peakDelayMinutes: stat.peakDelayMinutes,
    peakCollectedAt: stat.peakCollectedAt,
  };
}

function trainAtTime(candidates: Train[], collectedAt: string): Train | undefined {
  if (candidates.length <= 1) {
    return candidates[0];
  }
  const time = routeTimeMinutesInJapan(collectedAt);
  if (time === undefined) {
    return candidates[0];
  }
  return (
    candidates.find((train) => {
      const times = train.stops.flatMap(({ route_time_minutes }) =>
        route_time_minutes === undefined ? [] : [route_time_minutes],
      );
      if (times.length === 0) {
        return false;
      }
      const start = Math.min(...times);
      const end = Math.max(...times);
      return [time, time + 24 * 60].some(
        (candidate) => candidate >= start && candidate <= end,
      );
    }) ?? candidates[0]
  );
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
