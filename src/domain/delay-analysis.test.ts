import { describe, expect, it } from "vitest";

import type { TrainDelayAnalysisResponse } from "@raiquora/operation/analysis";
import type { Train } from "@raiquora/train/train";
import { delayAnalysisForAgent } from "./delay-analysis";

describe("delay analysis for the agent", () => {
  it("enriches delay rankings with timetable train metadata", () => {
    const result = delayAnalysisForAgent(analysis(), [
      train("100A", "新快速", "", "姫路"),
    ]);

    expect(result.latest?.topTrains[0]).toEqual({
      trainNumber: "100A",
      serviceType: "新快速",
      trainName: "",
      destination: "姫路",
      delayMinutes: 8,
    });
    expect(result.topTrains[0]).toEqual(
      expect.objectContaining({
        trainNumber: "100A",
        serviceType: "新快速",
        destination: "姫路",
        peakDelayMinutes: 12,
      }),
    );
  });

  it("keeps unmatched train numbers visible", () => {
    const result = delayAnalysisForAgent(analysis(), []);

    expect(result.unmatchedTrainCount).toBe(1);
    expect(result.topTrains[0]).toEqual(
      expect.objectContaining({
        trainNumber: "100A",
        serviceType: "不明",
        destination: "不明",
      }),
    );
  });

  it("keeps the compact result within the Bedrock tool-result limit", () => {
    const raw = analysis();
    const numbers = Array.from({ length: 10 }, (_, index) => `${index}999999M`);
    const topTrains = numbers.map((trainNumber, index) => ({
      trainNumber,
      delayMinutes: 999 - index,
    }));
    raw.latest = { ...raw.latest!, topTrains };
    raw.peak = { ...raw.peak!, topTrains };
    raw.hourly = raw.hourly.map((hour) => ({
      ...hour,
      sampleCount: 60,
      averageDelayedTrainCount: 999.99,
      peakDelayedTrainCount: 999,
      peakTotalDelayMinutes: 9_999,
      maximumDelayMinutes: 999,
      peakCollectedAt: "2026-07-29T08:15:00+00:00",
    }));
    raw.trainStats = numbers.map((trainNumber, index) => ({
      trainNumber,
      delayedSampleCount: 999,
      averageDelayWhenDelayed: 999.99,
      dailyAverageDelayContribution: 999.99,
      peakDelayMinutes: 999 - index,
      peakCollectedAt: "2026-07-29T08:15:00+00:00",
    }));
    const trains = numbers.map((trainNumber) =>
      train(
        trainNumber,
        "特急",
        "スーパーはくと99号",
        "非常に長い行き先駅名称",
      ),
    );

    const result = delayAnalysisForAgent(raw, trains);

    expect(JSON.stringify(result).length).toBeLessThanOrEqual(8_000);
  });
});

function analysis(): TrainDelayAnalysisResponse {
  const snapshot = {
    collectedAt: "2026-07-29T08:15:00+00:00",
    sourceCount: 26,
    failureCount: 0,
    observedTrainCount: 300,
    delayedTrainCount: 1,
    totalDelayMinutes: 8,
    maximumDelayMinutes: 8,
    topTrains: [{ trainNumber: "100A", delayMinutes: 8 }],
  };
  return {
    serviceDate: "2026-07-29",
    sampleCount: 60,
    observationStart: "2026-07-29T08:00:00+00:00",
    observationEnd: "2026-07-29T08:59:00+00:00",
    latest: snapshot,
    peak: snapshot,
    hourly: Array.from({ length: 24 }, (_, hourJst) => ({
      hourJst,
      sampleCount: 0,
      averageDelayedTrainCount: null,
      peakDelayedTrainCount: null,
      peakTotalDelayMinutes: null,
      maximumDelayMinutes: null,
      peakCollectedAt: null,
    })),
    trainStats: [
      {
        trainNumber: "100A",
        delayedSampleCount: 30,
        averageDelayWhenDelayed: 6,
        dailyAverageDelayContribution: 3,
        peakDelayMinutes: 12,
        peakCollectedAt: "2026-07-29T08:15:00+00:00",
      },
    ],
  };
}

function train(
  trainNumber: string,
  serviceType: string,
  trainName: string,
  destination: string,
): Train {
  return {
    service_uid: `${trainNumber}-service`,
    train_no: trainNumber,
    service_type: serviceType,
    train_name: trainName,
    origin_station: "京都",
    destination_station: destination,
    stops: [
      { station_name: "京都", route_time_minutes: 1_000 },
      { station_name: destination, route_time_minutes: 1_100 },
    ],
  };
}
