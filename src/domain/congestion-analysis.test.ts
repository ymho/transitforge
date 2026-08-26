import { describe, expect, it } from "vitest";

import type { DailyCongestionAnalysisResponse } from "./operations/analysis";
import type { Train } from "@raiquora/train/train";
import { congestionAnalysisForAgent } from "./congestion-analysis";

describe("congestion analysis for the agent", () => {
  it("enriches trains and aggregates their daily contribution by line", () => {
    const result = congestionAnalysisForAgent(
      analysis([
        stat("100A", 80, 120, 40),
        stat("200B", 60, 90, 30),
        stat("300C", 20, 35, 10),
      ]),
      [
        train("100A", "新快速", "", "姫路", 900, 1_000),
        train("200B", "特急", "はるか16号", "京都", 900, 1_000),
        train("300C", "普通", "", "奈良", 900, 1_000),
      ],
      (item) => (item.destination_station === "奈良" ? "奈良線" : "JR京都線"),
    );

    expect(result.topLines).toEqual([
      {
        lineName: "JR京都線",
        averageTotalCongestion: 70,
        trainCount: 2,
      },
      { lineName: "奈良線", averageTotalCongestion: 10, trainCount: 1 },
    ]);
    expect(result.topTrains[0]).toEqual(
      expect.objectContaining({
        trainNumber: "100A",
        serviceType: "新快速",
        destination: "姫路",
        lineName: "JR京都線",
      }),
    );
  });

  it("uses the service active at the recorded peak time for duplicate numbers", () => {
    const result = congestionAnalysisForAgent(
      analysis([stat("100A", 80, 120, 40)]),
      [
        train("100A", "普通", "", "大阪", 600, 700),
        train("100A", "快速", "", "京都", 1_000, 1_100),
      ],
      (item) => `${item.destination_station}方面`,
    );

    expect(result.topTrains[0]).toEqual(
      expect.objectContaining({
        serviceType: "快速",
        destination: "京都",
        lineName: "京都方面",
      }),
    );
  });

  it("keeps unmatched monitor trains visible as unknown metadata", () => {
    const result = congestionAnalysisForAgent(
      analysis([stat("unknown", 50, 60, 25)]),
      [],
      () => "unused",
    );

    expect(result.unmatchedTrainCount).toBe(1);
    expect(result.topTrains[0]).toEqual(
      expect.objectContaining({
        trainNumber: "unknown",
        serviceType: "不明",
        destination: "不明",
        lineName: "路線未判定",
      }),
    );
  });

  it("keeps the compact result within the Bedrock tool-result limit", () => {
    const trainStats = Array.from({ length: 10 }, (_, index) =>
      stat(`${index}999999M`, 9_999.99 - index, 99_999 - index, 999.99),
    );
    const raw = analysis(trainStats);
    raw.hourly = raw.hourly.map((hour) => ({
      ...hour,
      sampleCount: 60,
      averageTotalCongestion: 999_999.99,
      peakTotalCongestion: 999_999,
      peakCollectedAt: "2026-07-29T08:15:00+00:00",
      averageTrainCount: 999.99,
    }));
    raw.peak = {
      collectedAt: "2026-07-29T08:15:00+00:00",
      sourceUpdatedAt: "2026-07-29T08:14:50+00:00",
      totalCongestion: 999_999,
      trainCount: 999,
      carCount: 9_999,
      topTrains: trainStats.slice(0, 5).map(({ trainNumber }) => ({
        trainNumber,
        totalCongestion: 99_999,
      })),
    };
    const trains = trainStats.map(({ trainNumber }, index) =>
      train(
        trainNumber,
        "新快速",
        "スーパーはくと99号",
        `長い行き先駅名称${index}`,
        900,
        1_000,
      ),
    );

    const result = congestionAnalysisForAgent(
      raw,
      trains,
      () => "JR神戸線・山陽線（近畿エリア）",
    );

    expect(JSON.stringify(result).length).toBeLessThanOrEqual(8_000);
  });
});

function analysis(
  trainStats: DailyCongestionAnalysisResponse["trainStats"],
): DailyCongestionAnalysisResponse {
  return {
    serviceDate: "2026-07-29",
    sampleCount: 2,
    observationStart: "2026-07-29T07:30:00+00:00",
    observationEnd: "2026-07-29T08:15:00+00:00",
    peak: null,
    hourly: Array.from({ length: 24 }, (_, hourJst) => ({
      hourJst,
      sampleCount: 0,
      averageTotalCongestion: null,
      peakTotalCongestion: null,
      peakCollectedAt: null,
      averageTrainCount: null,
      topTrain: null,
    })),
    trainStats,
  };
}

function stat(
  trainNumber: string,
  averageCongestion: number,
  peakCongestion: number,
  dailyAverageContribution: number,
): DailyCongestionAnalysisResponse["trainStats"][number] {
  return {
    trainNumber,
    observedSampleCount: 2,
    averageCongestion,
    dailyAverageContribution,
    peakCongestion,
    peakCollectedAt: "2026-07-29T08:15:00+00:00",
  };
}

function train(
  trainNumber: string,
  serviceType: string,
  trainName: string,
  destination: string,
  start: number,
  end: number,
): Train {
  return {
    service_uid: `${trainNumber}-${destination}`,
    train_no: trainNumber,
    service_type: serviceType,
    train_name: trainName,
    origin_station: "始発",
    destination_station: destination,
    stops: [
      { station_name: "始発", route_time_minutes: start },
      { station_name: destination, route_time_minutes: end },
    ],
  };
}
