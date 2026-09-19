import { ApiAuthenticationError } from "../../../usecases/auth/api-authentication-error";
import { describe, expect, it, vi } from "vitest";

import {
  queryDailyCongestionAnalysis,
  queryDailyCongestionPeak,
  queryTrainDelayAnalysis,
  searchRepresentativeTimetable,
  searchWeatherGrid,
  searchTravelCandidates,
} from "./bedrock-agent";

describe("Bedrock agent client", () => {
  it("never retries a protected operation after authentication/session rejection", async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new ApiAuthenticationError("unauthenticated"));
    await expect(searchTravelCandidates({ serviceDate: "2026-09-19", originStation: "京都", destinationStation: "大阪", departureTimeMinutes: 600 }, request))
      .rejects.toMatchObject({ code: "unauthenticated" });
    expect(request).toHaveBeenCalledOnce();
  });
  it("requests a bounded local weather grid", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      weatherGrid: {
        status: "available",
        freshness: "fresh",
        evidence: [],
        data: { cells: [{
          id: "0-0",
          latitude: 34.7,
          longitude: 135.5,
          observedAt: "2026-08-30T14:00",
          mode: "rain",
          precipitationMillimeters: 1.2,
          cloudCoverPercent: 80,
          weatherCode: 61,
        }] },
      },
    }), { status: 200 }));

    const result = await searchWeatherGrid({
      points: [{ id: "0-0", latitude: 34.7, longitude: 135.5 }],
    }, fetcher);

    expect(result.weatherGrid.data?.cells[0]?.mode).toBe("rain");
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      operation: "weather_grid_search",
      points: [{ id: "0-0", latitude: 34.7, longitude: 135.5 }],
    });
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
      contractVersion: "journey-search-v1",
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
      contractVersion: "journey-search-v1",
      maxTransfers: 3,
      serviceDate: "2026-08-14",
      originStation: "西大路",
      destinationStation: "京都",
      departureTimeMinutes: 590,
      transferPace: "relaxed",
      rankingPreference: "fewest-transfers",
    });
  });

  it("rejects a journey response from another contract version", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({
      contractVersion: "journey-search-v2",
      serviceDate: "2026-08-14",
      originStation: "西大路",
      destinationStation: "京都",
      searchTimeMinutes: 590,
      totalMatchCount: 0,
      matches: [],
      journeys: [],
    }));

    await expect(searchTravelCandidates({
      serviceDate: "2026-08-14",
      originStation: "西大路",
      destinationStation: "京都",
      departureTimeMinutes: 590,
    }, fetcher)).rejects.toThrow("不正な応答");
  });
});
