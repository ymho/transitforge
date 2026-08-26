import { describe, expect, it } from "vitest";

import { analyzeCongestion, analyzeDelay } from "./analysis-engine";
import { isInOperatingDay, isValidServiceDate, nextServiceDate } from "./operating-day";

describe("operation analysis domain", () => {
  it("keeps 4:00 through 3:59 in one operating day", () => {
    expect(isValidServiceDate("2026-07-29")).toBe(true);
    expect(isValidServiceDate("2026-02-30")).toBe(false);
    expect(nextServiceDate("2026-07-29")).toBe("2026-07-30");
    expect(isInOperatingDay("2026-07-28T19:00:00+00:00", "2026-07-29")).toBe(true);
    expect(isInOperatingDay("2026-07-29T18:59:59+00:00", "2026-07-29")).toBe(true);
    expect(isInOperatingDay("2026-07-29T19:00:00+00:00", "2026-07-29")).toBe(false);
  });

  it("does not replace unobserved congestion with zero", () => {
    const result = analyzeCongestion("2026-07-29", [
      congestion("2026-07-29T07:00:00+00:00", 100, { "100A": 60, "200B": 40 }),
      congestion("2026-07-29T07:30:00+00:00", 200, { "100A": 100, "200B": 100 }),
      congestion("2026-07-29T08:15:00+00:00", 240, { "100A": 80, "300C": 160 }),
    ]);
    expect(result.sampleCount).toBe(3);
    expect(result.hourly[16]).toEqual({
      hourJst: 16, sampleCount: 2, averageTotalCongestion: 150,
      peakTotalCongestion: 200, peakCollectedAt: "2026-07-29T07:30:00+00:00",
      averageTrainCount: 2,
      topTrain: { trainNumber: "100A", observedSampleCount: 2, averageCongestion: 80, dailyAverageContribution: 80, peakCongestion: 100, peakCollectedAt: "2026-07-29T07:30:00+00:00" },
    });
    expect(result.hourly[0]?.averageTotalCongestion).toBeNull();
    expect(result.trainStats[0]).toMatchObject({ trainNumber: "300C", observedSampleCount: 1, dailyAverageContribution: 53.33 });
  });

  it("returns latest peak hourly and per-train delay observations", () => {
    const result = analyzeDelay("2026-07-29", [
      delay("2026-07-29T07:00:00+00:00", { "100A": 3, "200B": 8 }),
      delay("2026-07-29T07:30:00+00:00", { "100A": 5 }),
      delay("2026-07-29T08:15:00+00:00", { "300C": 12 }, 1),
    ]);
    expect(result.latest?.failureCount).toBe(1);
    expect(result.peak?.delayedTrainCount).toBe(2);
    expect(result.hourly[16]?.averageDelayedTrainCount).toBe(1.5);
    expect(result.hourly[0]?.maximumDelayMinutes).toBeNull();
    expect(result.trainStats[0]?.trainNumber).toBe("300C");
  });
});

function congestion(collectedAt: string, totalCongestion: number, trainTotals: Record<string, number>) {
  return { collectedAt, sourceUpdatedAt: collectedAt, totalCongestion, trainCount: Object.keys(trainTotals).length, carCount: 4, trainTotals };
}

function delay(collectedAt: string, trainDelays: Record<string, number>, failureCount = 0) {
  const values = Object.values(trainDelays);
  return { collectedAt, sourceCount: 1, failureCount, observedTrainCount: values.length, delayedTrainCount: values.length, totalDelayMinutes: values.reduce((a, b) => a + b, 0), maximumDelayMinutes: Math.max(...values), trainDelays };
}
