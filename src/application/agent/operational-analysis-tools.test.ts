import { describe, expect, it } from "vitest";

import type {
  DailyCongestionAnalysisResponse,
  TrainDelayAnalysisResponse,
} from "@raiquora/operation/analysis";
import type { Train } from "@raiquora/train/train";
import {
  createAnalyzeCongestionTool,
  createAnalyzeDelayTool,
  type OperationalAnalysisDependencies,
} from "./operational-analysis-tools";

const context = { executionId: "analysis-test" };

describe("operational analysis tools", () => {
  it("keeps an observed zero-delay sample distinct from an unobserved day", async () => {
    const dependencies = fixtureDependencies();
    const tool = createAnalyzeDelayTool(dependencies);

    const result = await tool.execute({ serviceDate: "2026-08-25" }, context);

    expect(result).toEqual({
      ok: true,
      output: expect.objectContaining({
        sampleCount: 1,
        latest: expect.objectContaining({
          delayedTrainCount: 0,
          totalDelayMinutes: 0,
        }),
        sourceMetadata: expect.objectContaining({
          source: "operating-day-summary",
          aggregation: "deterministic-v1",
          observationStatus: "observed",
          sampleCount: 1,
        }),
      }),
    });
  });

  it("keeps unobserved congestion values null", async () => {
    const dependencies = fixtureDependencies({
      congestion: emptyCongestionAnalysis(),
    });
    const tool = createAnalyzeCongestionTool(dependencies);

    const result = await tool.execute({ serviceDate: "2026-08-25" }, context);

    expect(result).toEqual({
      ok: true,
      output: expect.objectContaining({
        sampleCount: 0,
        peak: null,
        sourceMetadata: expect.objectContaining({
          observationStatus: "unobserved",
          observationStart: null,
          observationEnd: null,
        }),
      }),
    });
    if (result.ok) {
      expect(result.output.hourly).toHaveLength(24);
      expect(result.output.hourly.every((hour) =>
        hour.sampleCount === 0 && hour.averageTotalCongestion === null)).toBe(true);
    }
  });

  it("returns only bounded train and line rankings", async () => {
    const stats = Array.from({ length: 12 }, (_, index) => ({
      trainNumber: `${index}M`,
      observedSampleCount: 1,
      averageCongestion: 100 - index,
      dailyAverageContribution: 100 - index,
      peakCongestion: 100 - index,
      peakCollectedAt: "2026-08-25T03:00:00+00:00",
    }));
    const dependencies = fixtureDependencies({
      congestion: {
        ...emptyCongestionAnalysis(),
        sampleCount: 1,
        observationStart: "2026-08-25T03:00:00+00:00",
        observationEnd: "2026-08-25T03:00:00+00:00",
        trainStats: stats,
      },
      trains: stats.map((stat, index) =>
        train(stat.trainNumber, `行き先${index}`)),
    });
    const tool = createAnalyzeCongestionTool(dependencies);

    const result = await tool.execute({ serviceDate: "2026-08-25" }, context);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output.topTrains).toHaveLength(5);
      expect(result.output.topLines).toHaveLength(5);
    }
  });

  it("rejects invalid dates and unknown fields", () => {
    const tool = createAnalyzeDelayTool(fixtureDependencies());

    expect(tool.parseInput({ serviceDate: "2026-02-30" })).toEqual(
      expect.objectContaining({ ok: false }),
    );
    expect(tool.parseInput({
      serviceDate: "2026-08-25",
      rawSnapshots: true,
    })).toEqual(expect.objectContaining({ ok: false }));
  });

  it("returns a retryable error when the existing analysis source fails", async () => {
    const dependencies = fixtureDependencies();
    dependencies.loadDelayAnalysis = async () => {
      throw new Error("unavailable");
    };
    const tool = createAnalyzeDelayTool(dependencies);

    const result = await tool.execute({ serviceDate: "2026-08-25" }, context);

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "execution_failed",
        retryable: true,
      }),
    });
  });

  it("rejects an oversized enriched result", async () => {
    const huge = "列".repeat(30_000);
    const dependencies = fixtureDependencies({
      trains: [
        {
          ...train("100M", "京都"),
          train_name: huge,
        },
      ],
      delay: {
        ...observedZeroDelayAnalysis(),
        trainStats: [{
          trainNumber: "100M",
          delayedSampleCount: 1,
          averageDelayWhenDelayed: 1,
          dailyAverageDelayContribution: 1,
          peakDelayMinutes: 1,
          peakCollectedAt: "2026-08-25T03:00:00+00:00",
        }],
      },
    });
    const tool = createAnalyzeDelayTool(dependencies);

    const result = await tool.execute({ serviceDate: "2026-08-25" }, context);

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "execution_failed",
        retryable: false,
      }),
    });
  });
});

function fixtureDependencies(overrides: {
  delay?: TrainDelayAnalysisResponse;
  congestion?: DailyCongestionAnalysisResponse;
  trains?: Train[];
} = {}): OperationalAnalysisDependencies {
  const delay = overrides.delay ?? observedZeroDelayAnalysis();
  const congestion = overrides.congestion ?? emptyCongestionAnalysis();
  const trains = overrides.trains ?? [train("100M", "京都")];
  return {
    loadDelayAnalysis: async () => delay,
    loadCongestionAnalysis: async () => congestion,
    loadTrains: async () => trains,
    lineNameForTrain: (item) => `${item.destination_station}線`,
  };
}

function observedZeroDelayAnalysis(): TrainDelayAnalysisResponse {
  const snapshot = {
    collectedAt: "2026-08-25T03:00:00+00:00",
    sourceCount: 17,
    failureCount: 0,
    observedTrainCount: 120,
    delayedTrainCount: 0,
    totalDelayMinutes: 0,
    maximumDelayMinutes: 0,
    topTrains: [],
  };
  return {
    serviceDate: "2026-08-25",
    sampleCount: 1,
    observationStart: snapshot.collectedAt,
    observationEnd: snapshot.collectedAt,
    latest: snapshot,
    peak: snapshot,
    hourly: Array.from({ length: 24 }, (_, hourJst) => ({
      hourJst,
      sampleCount: hourJst === 12 ? 1 : 0,
      averageDelayedTrainCount: hourJst === 12 ? 0 : null,
      peakDelayedTrainCount: hourJst === 12 ? 0 : null,
      peakTotalDelayMinutes: hourJst === 12 ? 0 : null,
      maximumDelayMinutes: hourJst === 12 ? 0 : null,
      peakCollectedAt: hourJst === 12 ? snapshot.collectedAt : null,
    })),
    trainStats: [],
  };
}

function emptyCongestionAnalysis(): DailyCongestionAnalysisResponse {
  return {
    serviceDate: "2026-08-25",
    sampleCount: 0,
    observationStart: null,
    observationEnd: null,
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
    trainStats: [],
  };
}

function train(trainNumber: string, destination: string): Train {
  return {
    service_uid: `${trainNumber}-${destination}`,
    train_no: trainNumber,
    service_type: "普通",
    train_name: "",
    origin_station: "大阪",
    destination_station: destination,
    stops: [
      { station_name: "大阪", route_time_minutes: 720 },
      { station_name: destination, route_time_minutes: 780 },
    ],
  };
}
