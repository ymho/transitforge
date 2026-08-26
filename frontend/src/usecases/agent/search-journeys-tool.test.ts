import { describe, expect, it, vi } from "vitest";

import { searchTravelCandidates } from "../../adapters/http/agent-api/bedrock-agent";
import type {
  JourneySearchRequest,
  JourneySearchResponse,
  JourneySearchService,
} from "@raiquora/journey/journey-search-service";
import {
  createSearchJourneysTool,
  maximumJourneyToolPayloadBytes,
  maximumJourneyToolResults,
} from "./search-journeys-tool";
import { AgentToolRegistry } from "./tool-registry";

const request: JourneySearchRequest = {
  serviceDate: "2026-08-25",
  originStation: "京都",
  destinationStation: "出雲市",
  departureTimeMinutes: 480,
  transferPace: "relaxed",
  rankingPreference: "fewest-transfers",
  requiredTrainNames: ["やくも"],
};

const response = (suffix = ""): JourneySearchResponse => ({
  serviceDate: request.serviceDate,
  originStation: request.originStation,
  destinationStation: request.destinationStation,
  searchTimeMinutes: request.departureTimeMinutes,
  totalMatchCount: 1,
  transferPace: "relaxed",
  rankingPreference: "fewest-transfers",
  maxTransfers: 3,
  requiredTrainNames: ["やくも"],
  matches: [{
    serviceUid: `service${suffix}`,
    trainNumber: "1001M",
    serviceType: "特急",
    trainName: "やくも1号",
    originStation: "岡山",
    destinationStation: "出雲市",
    departureTimeMinutes: 600,
    arrivalTimeMinutes: 780,
    scheduledDepartureTimeMinutes: 595,
    scheduledArrivalTimeMinutes: 775,
    delayMinutes: 5,
    delayStatus: "observed",
    delaySampleCount: 3,
    delayBasis: "train-number",
    source: "transitforge",
    discoverySource: "timetable-graph",
    sourceReference: "2026-08-25/connection-index.json.gz",
  }],
  journeys: [{
    departureTimeMinutes: 480,
    arrivalTimeMinutes: 780,
    transferCount: 1,
    legs: [{
      serviceUid: `service${suffix}`,
      trainNumber: "1001M",
      serviceType: "特急",
      trainName: "やくも1号",
      serviceDestination: "出雲市",
      originStation: "岡山",
      destinationStation: "出雲市",
      departureTimeMinutes: 600,
      arrivalTimeMinutes: 780,
      scheduledDepartureTimeMinutes: 595,
      scheduledArrivalTimeMinutes: 775,
      delayMinutes: 5,
      delayStatus: "observed",
      delaySampleCount: 3,
      delayBasis: "train-number",
      stops: [
        { stationName: "岡山", departureTimeMinutes: 600 },
        { stationName: "出雲市", arrivalTimeMinutes: 780 },
      ],
    }],
  }],
});

describe("search_journeys tool", () => {
  const context = { executionId: "execution-1" };

  it("returns the same candidates times constraints and delay metadata as the API", async () => {
    const apiResponse = response();
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({
      contractVersion: "journey-search-v1",
      ...apiResponse,
    }));
    const service: JourneySearchService = {
      search: (input) => searchTravelCandidates(input, fetcher),
    };
    const registry = new AgentToolRegistry();
    registry.register(createSearchJourneysTool(service));

    const result = await registry.execute("search_journeys", request, context);

    expect(result).toEqual({ ok: true, output: apiResponse });
    expect(result).toMatchObject({
      output: {
        requiredTrainNames: ["やくも"],
        matches: [{ delayMinutes: 5, delayStatus: "observed" }],
        journeys: [{ departureTimeMinutes: 480, arrivalTimeMinutes: 780 }],
      },
    });
  });

  it("limits result counts before returning them to the agent", async () => {
    const many = response();
    many.totalMatchCount = 5;
    many.matches = Array.from({ length: 5 }, (_, index) =>
      response(String(index)).matches[0]);
    many.journeys = Array.from({ length: 5 }, (_, index) =>
      response(String(index)).journeys[0]);
    const search = vi.fn(async () => many);
    const registry = new AgentToolRegistry();
    registry.register(createSearchJourneysTool({ search }));

    const result = await registry.execute(
      "search_journeys",
      { ...request, limit: 2 },
      context,
    );

    expect(result).toMatchObject({
      ok: true,
      output: { totalMatchCount: 5, matches: [{}, {}], journeys: [{}, {}] },
    });
    expect(search).toHaveBeenCalledWith(expect.objectContaining({
      limit: 2,
      maxTransfers: 3,
    }));
    expect(maximumJourneyToolResults).toBe(3);
  });

  it("rejects invalid input before calling the service", async () => {
    const search = vi.fn(async () => response());
    const registry = new AgentToolRegistry();
    registry.register(createSearchJourneysTool({ search }));

    const result = await registry.execute(
      "search_journeys",
      { ...request, serviceDate: "2026-02-30", limit: 4 },
      context,
    );

    expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(search).not.toHaveBeenCalled();
  });

  it("does not return a payload over the tool limit", async () => {
    const oversized = response();
    oversized.matches[0].trainName = "長".repeat(maximumJourneyToolPayloadBytes);
    const registry = new AgentToolRegistry();
    registry.register(createSearchJourneysTool({ search: async () => oversized }));

    const result = await registry.execute("search_journeys", request, context);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "execution_failed", retryable: false },
    });
  });
});
