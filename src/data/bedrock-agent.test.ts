import { describe, expect, it, vi } from "vitest";

import {
  invokeBedrockAgent,
  queryDailyCongestionAnalysis,
  queryDailyCongestionPeak,
  queryTrainDelayAnalysis,
  sha256Hex,
  type BedrockAgentResponse,
} from "./bedrock-agent";

describe("Bedrock agent client", () => {
  it("sends the payload hash required by a CloudFront Lambda origin", async () => {
    const bedrockResponse: BedrockAgentResponse = {
      message: {
        role: "assistant",
        content: [{ text: "案内しました。" }],
      },
      stopReason: "end_turn",
    };
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify(bedrockResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await invokeBedrockAgent(
      [{ role: "user", content: [{ text: "京都行きを見せて" }] }],
      fetcher,
    );

    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("/api/agent");
    expect(init?.method).toBe("POST");
    expect(
      new Headers(init?.headers).get("X-Amz-Content-Sha256"),
    ).toBe(await sha256Hex(String(init?.body)));
  });

  it("rejects an unexpected response shape", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ message: "unexpected" }), { status: 200 }),
    );

    await expect(
      invokeBedrockAgent(
        [{ role: "user", content: [{ text: "案内して" }] }],
        fetcher,
      ),
    ).rejects.toThrow("不正な応答");
  });

  it("requests a daily congestion peak through the protected endpoint", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          serviceDate: "2026-07-29",
          sampleCount: 64,
          peak: {
            collectedAt: "2026-07-29T08:15:00+00:00",
            sourceUpdatedAt: "2026-07-29T08:14:50+00:00",
            totalCongestion: 3_934,
            trainCount: 38,
            carCount: 291,
            topTrains: [
              { trainNumber: "1655H", totalCongestion: 240 },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await queryDailyCongestionPeak("2026-07-29", fetcher);

    expect(result.peak?.totalCongestion).toBe(3_934);
    const [, init] = fetcher.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({
      operation: "daily_congestion_peak",
      serviceDate: "2026-07-29",
    });
  });

  it("requests the full daily congestion analysis through the protected endpoint", async () => {
    const hourly = Array.from({ length: 24 }, (_, hourJst) => ({
      hourJst,
      sampleCount: hourJst === 17 ? 60 : 0,
      averageTotalCongestion: hourJst === 17 ? 2_800 : null,
      peakTotalCongestion: hourJst === 17 ? 3_934 : null,
      peakCollectedAt:
        hourJst === 17 ? "2026-07-29T08:15:00+00:00" : null,
      averageTrainCount: hourJst === 17 ? 38 : null,
      topTrain:
        hourJst === 17
          ? {
              trainNumber: "1655H",
              observedSampleCount: 60,
              averageCongestion: 180,
              dailyAverageContribution: 180,
              peakCongestion: 240,
              peakCollectedAt: "2026-07-29T08:15:00+00:00",
            }
          : null,
    }));
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          serviceDate: "2026-07-29",
          sampleCount: 60,
          observationStart: "2026-07-29T08:00:00+00:00",
          observationEnd: "2026-07-29T08:59:00+00:00",
          peak: {
            collectedAt: "2026-07-29T08:15:00+00:00",
            sourceUpdatedAt: "2026-07-29T08:14:50+00:00",
            totalCongestion: 3_934,
            trainCount: 38,
            carCount: 291,
            topTrains: [
              { trainNumber: "1655H", totalCongestion: 240 },
            ],
          },
          hourly,
          trainStats: [hourly[17]?.topTrain],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await queryDailyCongestionAnalysis("2026-07-29", fetcher);

    expect(result.hourly[17]?.averageTotalCongestion).toBe(2_800);
    const [, init] = fetcher.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({
      operation: "daily_congestion_analysis",
      serviceDate: "2026-07-29",
    });
  });

  it("requests train delay analysis through the protected endpoint", async () => {
    const hourly = Array.from({ length: 24 }, (_, hourJst) => ({
      hourJst,
      sampleCount: hourJst === 17 ? 60 : 0,
      averageDelayedTrainCount: hourJst === 17 ? 4.5 : null,
      peakDelayedTrainCount: hourJst === 17 ? 8 : null,
      peakTotalDelayMinutes: hourJst === 17 ? 42 : null,
      maximumDelayMinutes: hourJst === 17 ? 12 : null,
      peakCollectedAt:
        hourJst === 17 ? "2026-07-29T08:15:00+00:00" : null,
    }));
    const snapshot = {
      collectedAt: "2026-07-29T08:59:00+00:00",
      sourceCount: 26,
      failureCount: 0,
      observedTrainCount: 300,
      delayedTrainCount: 4,
      totalDelayMinutes: 18,
      maximumDelayMinutes: 8,
      topTrains: [{ trainNumber: "1655H", delayMinutes: 8 }],
    };
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          serviceDate: "2026-07-29",
          sampleCount: 60,
          observationStart: "2026-07-29T08:00:00+00:00",
          observationEnd: "2026-07-29T08:59:00+00:00",
          latest: snapshot,
          peak: snapshot,
          hourly,
          trainStats: [
            {
              trainNumber: "1655H",
              delayedSampleCount: 30,
              averageDelayWhenDelayed: 6,
              dailyAverageDelayContribution: 3,
              peakDelayMinutes: 8,
              peakCollectedAt: "2026-07-29T08:15:00+00:00",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await queryTrainDelayAnalysis("2026-07-29", fetcher);

    expect(result.latest?.delayedTrainCount).toBe(4);
    const [, init] = fetcher.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({
      operation: "train_delay_analysis",
      serviceDate: "2026-07-29",
    });
  });
});
