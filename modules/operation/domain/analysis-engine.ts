import type {
  DailyCongestionAnalysisResponse,
  DailyCongestionPeak,
  HourlyCongestionAnalysis,
  HourlyTrainDelayAnalysis,
  TrainCongestionStat,
  TrainDelayAnalysisResponse,
  TrainDelaySnapshotAnalysis,
  TrainDelayStat,
} from "./analysis.js";
import { hourInJst } from "./operating-day.js";

export interface CongestionObservation {
  collectedAt: string;
  sourceUpdatedAt: string;
  totalCongestion: number;
  trainCount: number;
  carCount: number;
  trainTotals: Record<string, number>;
}

export interface DelayObservation {
  collectedAt: string;
  sourceCount: number;
  failureCount: number;
  observedTrainCount: number;
  delayedTrainCount: number;
  totalDelayMinutes: number;
  maximumDelayMinutes: number;
  trainDelays: Record<string, number>;
}

export function analyzeCongestion(
  serviceDate: string,
  observations: CongestionObservation[],
): DailyCongestionAnalysisResponse {
  const samples = [...observations].sort(byCollectedAt);
  if (samples.length === 0) return {
    serviceDate, sampleCount: 0, observationStart: null, observationEnd: null,
    peak: null, hourly: Array.from({ length: 24 }, (_, hour) => emptyCongestionHour(hour)), trainStats: [],
  };
  const peak = samples.reduce((current, sample) => congestionPeakOrder(sample, current) >= 0 ? sample : current);
  return {
    serviceDate,
    sampleCount: samples.length,
    observationStart: samples[0]!.collectedAt,
    observationEnd: samples.at(-1)!.collectedAt,
    peak: congestionPeak(peak),
    hourly: Array.from({ length: 24 }, (_, hour) => congestionHour(hour, samples.filter((sample) => hourInJst(sample.collectedAt) === hour))),
    trainStats: congestionStats(samples),
  };
}

export function analyzeDelay(
  serviceDate: string,
  observations: DelayObservation[],
): TrainDelayAnalysisResponse {
  const samples = [...observations].sort(byCollectedAt);
  if (samples.length === 0) return {
    serviceDate, sampleCount: 0, observationStart: null, observationEnd: null,
    latest: null, peak: null,
    hourly: Array.from({ length: 24 }, (_, hour) => emptyDelayHour(hour)), trainStats: [],
  };
  const peak = samples.reduce((current, sample) => delayPeakOrder(sample, current) >= 0 ? sample : current);
  return {
    serviceDate,
    sampleCount: samples.length,
    observationStart: samples[0]!.collectedAt,
    observationEnd: samples.at(-1)!.collectedAt,
    latest: delaySnapshot(samples.at(-1)!),
    peak: delaySnapshot(peak),
    hourly: Array.from({ length: 24 }, (_, hour) => delayHour(hour, samples.filter((sample) => hourInJst(sample.collectedAt) === hour))),
    trainStats: delayStats(samples),
  };
}

function congestionPeak(sample: CongestionObservation): DailyCongestionPeak {
  return {
    collectedAt: sample.collectedAt,
    sourceUpdatedAt: sample.sourceUpdatedAt,
    totalCongestion: sample.totalCongestion,
    trainCount: Math.trunc(sample.trainCount),
    carCount: Math.trunc(sample.carCount),
    topTrains: Object.entries(sample.trainTotals)
      .map(([trainNumber, totalCongestion]) => ({ trainNumber, totalCongestion }))
      .sort((a, b) => b.totalCongestion - a.totalCongestion || a.trainNumber.localeCompare(b.trainNumber))
      .slice(0, 5),
  };
}

function congestionHour(hour: number, samples: CongestionObservation[]): HourlyCongestionAnalysis {
  if (samples.length === 0) return emptyCongestionHour(hour);
  const peak = samples.reduce((current, sample) => congestionPeakOrder(sample, current) >= 0 ? sample : current);
  const stats = congestionStatMap(samples);
  const top = [...stats.entries()].sort((a, b) =>
    b[1].sum / b[1].count - a[1].sum / a[1].count || b[1].peak - a[1].peak || b[0].localeCompare(a[0]))[0];
  return {
    hourJst: hour,
    sampleCount: samples.length,
    averageTotalCongestion: average(samples.map(({ totalCongestion }) => totalCongestion)),
    peakTotalCongestion: peak.totalCongestion,
    peakCollectedAt: peak.collectedAt,
    averageTrainCount: average(samples.map(({ trainCount }) => trainCount)),
    topTrain: top ? congestionStat(top[0], top[1], samples.length) : null,
  };
}

function emptyCongestionHour(hour: number): HourlyCongestionAnalysis {
  return { hourJst: hour, sampleCount: 0, averageTotalCongestion: null, peakTotalCongestion: null, peakCollectedAt: null, averageTrainCount: null, topTrain: null };
}

type CongestionAccumulator = { sum: number; count: number; peak: number; peakCollectedAt: string };

function congestionStatMap(samples: CongestionObservation[]): Map<string, CongestionAccumulator> {
  const result = new Map<string, CongestionAccumulator>();
  for (const sample of samples) for (const [trainNumber, value] of Object.entries(sample.trainTotals)) {
    const current = result.get(trainNumber) ?? { sum: 0, count: 0, peak: -1, peakCollectedAt: sample.collectedAt };
    current.sum += value;
    current.count += 1;
    if (value >= current.peak) { current.peak = value; current.peakCollectedAt = sample.collectedAt; }
    result.set(trainNumber, current);
  }
  return result;
}

function congestionStats(samples: CongestionObservation[]): TrainCongestionStat[] {
  return [...congestionStatMap(samples)].map(([number, stat]) => congestionStat(number, stat, samples.length))
    .sort((a, b) => b.peakCongestion - a.peakCongestion || b.averageCongestion - a.averageCongestion || a.trainNumber.localeCompare(b.trainNumber));
}

function congestionStat(trainNumber: string, stat: CongestionAccumulator, total: number): TrainCongestionStat {
  return { trainNumber, observedSampleCount: stat.count, averageCongestion: rounded(stat.sum / stat.count), dailyAverageContribution: rounded(stat.sum / total), peakCongestion: stat.peak, peakCollectedAt: stat.peakCollectedAt };
}

function delaySnapshot(sample: DelayObservation): TrainDelaySnapshotAnalysis {
  return {
    collectedAt: sample.collectedAt,
    sourceCount: Math.trunc(sample.sourceCount), failureCount: Math.trunc(sample.failureCount), observedTrainCount: Math.trunc(sample.observedTrainCount), delayedTrainCount: Math.trunc(sample.delayedTrainCount),
    totalDelayMinutes: sample.totalDelayMinutes, maximumDelayMinutes: sample.maximumDelayMinutes,
    topTrains: Object.entries(sample.trainDelays).map(([trainNumber, delayMinutes]) => ({ trainNumber, delayMinutes })).sort((a, b) => b.delayMinutes - a.delayMinutes || a.trainNumber.localeCompare(b.trainNumber)).slice(0, 10),
  };
}

function delayHour(hour: number, samples: DelayObservation[]): HourlyTrainDelayAnalysis {
  if (samples.length === 0) return emptyDelayHour(hour);
  const peak = samples.reduce((current, sample) => delayPeakOrder(sample, current) >= 0 ? sample : current);
  return { hourJst: hour, sampleCount: samples.length, averageDelayedTrainCount: average(samples.map(({ delayedTrainCount }) => delayedTrainCount)), peakDelayedTrainCount: Math.trunc(peak.delayedTrainCount), peakTotalDelayMinutes: peak.totalDelayMinutes, maximumDelayMinutes: Math.max(...samples.map(({ maximumDelayMinutes }) => maximumDelayMinutes)), peakCollectedAt: peak.collectedAt };
}

function emptyDelayHour(hour: number): HourlyTrainDelayAnalysis {
  return { hourJst: hour, sampleCount: 0, averageDelayedTrainCount: null, peakDelayedTrainCount: null, peakTotalDelayMinutes: null, maximumDelayMinutes: null, peakCollectedAt: null };
}

function delayStats(samples: DelayObservation[]): TrainDelayStat[] {
  const stats = new Map<string, CongestionAccumulator>();
  for (const sample of samples) for (const [number, delay] of Object.entries(sample.trainDelays)) {
    const current = stats.get(number) ?? { sum: 0, count: 0, peak: -1, peakCollectedAt: sample.collectedAt };
    current.sum += delay; current.count += 1;
    if (delay >= current.peak) { current.peak = delay; current.peakCollectedAt = sample.collectedAt; }
    stats.set(number, current);
  }
  return [...stats].map(([trainNumber, stat]) => ({ trainNumber, delayedSampleCount: stat.count, averageDelayWhenDelayed: rounded(stat.sum / stat.count), dailyAverageDelayContribution: rounded(stat.sum / samples.length), peakDelayMinutes: stat.peak, peakCollectedAt: stat.peakCollectedAt }))
    .sort((a, b) => b.peakDelayMinutes - a.peakDelayMinutes || b.delayedSampleCount - a.delayedSampleCount || a.trainNumber.localeCompare(b.trainNumber));
}

function congestionPeakOrder(a: CongestionObservation, b: CongestionObservation): number { return a.totalCongestion - b.totalCongestion || a.collectedAt.localeCompare(b.collectedAt); }
function delayPeakOrder(a: DelayObservation, b: DelayObservation): number { return a.delayedTrainCount - b.delayedTrainCount || a.totalDelayMinutes - b.totalDelayMinutes || a.collectedAt.localeCompare(b.collectedAt); }
function byCollectedAt(a: { collectedAt: string }, b: { collectedAt: string }): number { return a.collectedAt.localeCompare(b.collectedAt); }
function average(values: number[]): number { return rounded(values.reduce((sum, value) => sum + value, 0) / values.length); }
function rounded(value: number): number { return Math.round((value + Number.EPSILON) * 100) / 100; }
