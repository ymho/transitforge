import { describe, expect, it, vi } from "vitest";

import type { JourneySearchResponse } from "../../domain/journey-search-service";
import {
  createCompareJourneysTool,
  type VerifiedJourneySearchResultSource,
} from "./compare-journeys-tool";

const executionId = "execution-compare";
const searchResultId = "search-result-1";
const context = { executionId };

describe("compare_journeys tool", () => {
  it("compares verified candidates deterministically with structured reasons", async () => {
    const source = fixtureSource(searchResult());
    const tool = createCompareJourneysTool(source);

    const first = await tool.execute({ searchResultId }, context);
    const second = await tool.execute({ searchResultId }, context);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      ok: true,
      output: {
        recommendedCandidateId: "journey-2",
        source: "verified-journey-search-result",
        candidates: [
          {
            candidateId: "journey-1",
            durationMinutes: 120,
            transferCount: 0,
            constraintsSatisfied: false,
            delay: { totalAppliedDelayMinutes: 8, observedLegCount: 1 },
          },
          {
            candidateId: "journey-2",
            durationMinutes: 105,
            transferCount: 1,
            constraintsSatisfied: true,
            advantages: expect.arrayContaining([
              "earliest_arrival",
              "shortest_duration",
              "all_constraints_satisfied",
            ]),
          },
          {
            candidateId: "journey-3",
            constraintsSatisfied: true,
            advantages: expect.arrayContaining(["latest_departure"]),
          },
        ],
      },
    });
  });

  it("reports each explicit constraint violation without prose generation", async () => {
    const tool = createCompareJourneysTool(fixtureSource(searchResult()));

    const result = await tool.execute({
      searchResultId,
      journeyIndexes: [0],
    }, context);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output.candidates[0].constraintEvaluations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "excluded_service_type",
            expected: "新幹線",
            actual: ["新幹線"],
            satisfied: false,
          }),
          expect.objectContaining({
            kind: "maximum_transfers",
            expected: 2,
            actual: 0,
            satisfied: true,
          }),
        ]),
      );
    }
  });

  it("limits a verified result to three candidates", async () => {
    const resultWithExtraCandidates = searchResult();
    resultWithExtraCandidates.journeys.push(
      resultWithExtraCandidates.journeys[0],
      resultWithExtraCandidates.journeys[1],
    );
    const tool = createCompareJourneysTool(fixtureSource(resultWithExtraCandidates));

    const result = await tool.execute({ searchResultId }, context);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output.candidates).toHaveLength(3);
  });

  it("cannot compare a result that was not verified in the same execution", async () => {
    const resolve = vi.fn(async () => undefined);
    const tool = createCompareJourneysTool({ resolve });

    const result = await tool.execute({ searchResultId: "invented" }, context);

    expect(resolve).toHaveBeenCalledWith(executionId, "invented");
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "not_found",
        retryable: false,
      }),
    });
  });

  it("rejects unbounded duplicate and unknown candidate indexes", async () => {
    const source = fixtureSource(searchResult());
    const tool = createCompareJourneysTool(source);

    expect(tool.parseInput({ searchResultId, journeyIndexes: [0, 0] })).toEqual(
      expect.objectContaining({ ok: false }),
    );
    expect(tool.parseInput({ searchResultId, journeys: [] })).toEqual(
      expect.objectContaining({ ok: false }),
    );
    const result = await tool.execute({ searchResultId, journeyIndexes: [9] }, context);
    expect(result).toMatchObject({
      ok: false,
      error: { code: "invalid_input", retryable: false },
    });
  });
});

function fixtureSource(
  result: JourneySearchResponse,
): VerifiedJourneySearchResultSource {
  return {
    resolve: async (requestedExecutionId, requestedResultId) =>
      requestedExecutionId === executionId && requestedResultId === searchResultId
        ? result
        : undefined,
  };
}

function searchResult(): JourneySearchResponse {
  return {
    serviceDate: "2026-08-25",
    originStation: "京都",
    destinationStation: "岡山",
    searchTimeMinutes: 480,
    totalMatchCount: 3,
    rankingPreference: "earliest-arrival",
    maxTransfers: 2,
    excludedServiceTypes: ["新幹線"],
    allowedServiceTypes: ["新快速", "普通", "快速", "新幹線"],
    matches: [],
    journeys: [
      journey(480, 600, [leg("shinkansen", "新幹線", 480, 600, 8, "observed")]),
      journey(485, 590, [
        leg("rapid", "新快速", 485, 535, 0),
        leg("local", "普通", 545, 590, 0),
      ]),
      journey(500, 605, [leg("rapid-2", "快速", 500, 605, 3, "estimated")]),
    ],
  };
}

function journey(
  departureTimeMinutes: number,
  arrivalTimeMinutes: number,
  legs: JourneySearchResponse["journeys"][number]["legs"],
): JourneySearchResponse["journeys"][number] {
  return {
    departureTimeMinutes,
    arrivalTimeMinutes,
    transferCount: Math.max(0, legs.length - 1),
    legs,
  };
}

function leg(
  serviceUid: string,
  serviceType: string,
  departureTimeMinutes: number,
  arrivalTimeMinutes: number,
  delayMinutes: number,
  delayStatus?: "observed" | "estimated",
): JourneySearchResponse["journeys"][number]["legs"][number] {
  return {
    serviceUid,
    trainNumber: serviceUid,
    serviceType,
    trainName: "",
    originStation: "京都",
    destinationStation: "岡山",
    departureTimeMinutes,
    arrivalTimeMinutes,
    scheduledDepartureTimeMinutes: departureTimeMinutes - delayMinutes,
    scheduledArrivalTimeMinutes: arrivalTimeMinutes - delayMinutes,
    delayMinutes,
    ...(delayStatus === undefined ? {} : { delayStatus }),
  };
}
