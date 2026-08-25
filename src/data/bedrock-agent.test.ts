import { describe, expect, it, vi } from "vitest";

import {
  invokeBedrockAgent,
  queryDailyCongestionAnalysis,
  queryDailyCongestionPeak,
  queryTrainDelayAnalysis,
  searchRepresentativeTimetable,
  searchTravelCandidates,
  sha256Hex,
  type BedrockAgentResponse,
} from "./bedrock-agent";

describe("Bedrock agent client", () => {
  it("returns the request ID with its agent response", async () => {
    const result = await invokeBedrockAgent([{ role: "user", content: [{ text: "京都に行きたい" }] }], async () => new Response(
      JSON.stringify({ message: { role: "assistant", content: [{ text: "案内します" }] }, stopReason: "end_turn" }),
      { status: 200, headers: { "x-transitforge-request-id": "request-123" } },
    ));
    expect(result.metadata.requestId).toBe("request-123");
    expect(result.body.stopReason).toBe("end_turn");
  });
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

  it("retries the AI guide once after a transient server error", async () => {
    const bedrockResponse: BedrockAgentResponse = {
      message: {
        role: "assistant",
        content: [{ text: "案内しました。" }],
      },
      stopReason: "end_turn",
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, {
        status: 503,
        headers: { "x-transitforge-request-id": "request-first" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify(bedrockResponse), {
        status: 200,
        headers: { "x-transitforge-request-id": "request-final" },
      }));

    const result = await invokeBedrockAgent(
      [{ role: "user", content: [{ text: "京都に行きたい" }] }],
      fetcher,
    );

    expect(result.body).toEqual(bedrockResponse);
    expect(result.metadata.requestId).toBe("request-final");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps concurrent response metadata separate", async () => {
    const responseBody = (text: string) => JSON.stringify({
      message: { role: "assistant", content: [{ text }] },
      stopReason: "end_turn",
    });
    const [first, second] = await Promise.all([
      invokeBedrockAgent([], async () => new Response(responseBody("最初"), {
        headers: { "x-transitforge-request-id": "request-a" },
      })),
      invokeBedrockAgent([], async () => new Response(responseBody("次"), {
        headers: { "x-transitforge-request-id": "request-b" },
      })),
    ]);

    expect(first.metadata.requestId).toBe("request-a");
    expect(second.metadata.requestId).toBe("request-b");
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

  it("searches a private representative timetable through the protected endpoint", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        timetableKind: "weekday",
        serviceDate: "2026-07-31",
        mode: "arrivals",
        targetTimeMinutes: 600,
        totalMatchCount: 1,
        matches: [
          {
            trainNumber: "101M",
            serviceType: "特急",
            trainName: "はるか16号",
            origin: "関西空港",
            destination: "京都",
            matchingStops: [
              {
                stationName: "大阪",
                event: "着",
                routeTimeMinutes: 600,
              },
            ],
          },
        ],
      }),
    );

    const result = await searchRepresentativeTimetable(
      {
        timetableKind: "weekday",
        query: "平日の10時ごろ大阪に着く特急",
        mode: "arrivals",
        targetTimeMinutes: 600,
      },
      fetcher,
    );

    expect(result.matches[0]?.trainNumber).toBe("101M");
    const [, init] = fetcher.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      operation: "representative_timetable_search",
      timetableKind: "weekday",
      mode: "arrivals",
    });
  });

  it("searches server-side timetable journeys", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({
      serviceDate: "2026-08-14",
      originStation: "西大路",
      destinationStation: "京都",
      searchTimeMinutes: 590,
      totalMatchCount: 1,
      matches: [{
        serviceUid: "service-1",
        trainNumber: "538C",
        serviceType: "普通",
        trainName: "",
        originStation: "西大路",
        destinationStation: "京都",
        departureTimeMinutes: 605,
        arrivalTimeMinutes: 613,
        scheduledDepartureTimeMinutes: 600,
        scheduledArrivalTimeMinutes: 608,
        delayMinutes: 5,
        source: "transitforge",
        discoverySource: "timetable-graph",
        sourceReference: "connection-scan",
      }],
      journeys: [{
        departureTimeMinutes: 605,
        arrivalTimeMinutes: 613,
        transferCount: 0,
        legs: [{
          serviceUid: "service-1",
          trainNumber: "538C",
          serviceType: "普通",
          trainName: "",
          originStation: "西大路",
          destinationStation: "京都",
          departureTimeMinutes: 605,
          arrivalTimeMinutes: 613,
          scheduledDepartureTimeMinutes: 600,
          scheduledArrivalTimeMinutes: 608,
          delayMinutes: 5,
        }],
      }],
    }));

    const result = await searchTravelCandidates({
      serviceDate: "2026-08-14",
      originStation: "西大路",
      destinationStation: "京都",
      departureTimeMinutes: 590,
      transferPace: "relaxed",
      rankingPreference: "fewest-transfers",
    }, fetcher);

    expect(result.matches[0]?.delayMinutes).toBe(5);
    const [, init] = fetcher.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({
      operation: "journey_search",
      maxTransfers: 3,
      serviceDate: "2026-08-14",
      originStation: "西大路",
      destinationStation: "京都",
      departureTimeMinutes: 590,
      transferPace: "relaxed",
      rankingPreference: "fewest-transfers",
    });
  });
});
