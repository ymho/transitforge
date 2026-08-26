import { describe, expect, it } from "vitest";

import { VerifiedJourneySearchResultStore } from "./verified-journey-results";
import type { JourneySearchResponse } from "@raiquora/journey/journey-search-service";

describe("VerifiedJourneySearchResultStore", () => {
  it("resolves only results saved by the same execution and returns a copy", async () => {
    const store = new VerifiedJourneySearchResultStore();
    const source = fixtureResult();
    const resultId = store.save("execution-1", source);

    const resolved = await store.resolve("execution-1", resultId);
    expect(resultId).toBe("journey-search-1");
    expect(resolved).toEqual(source);
    expect(await store.resolve("execution-2", resultId)).toBeUndefined();
    if (resolved) resolved.originStation = "変更";
    expect((await store.resolve("execution-1", resultId))?.originStation).toBe("京都");
  });

  it("bounds results and executions and can clear task state", async () => {
    const store = new VerifiedJourneySearchResultStore(1, 1);
    store.save("execution-1", fixtureResult());
    expect(() => store.save("execution-1", fixtureResult())).toThrow("上限");

    const secondId = store.save("execution-2", fixtureResult());
    expect(await store.resolve("execution-1", "journey-search-1")).toBeUndefined();
    store.clear("execution-2");
    expect(await store.resolve("execution-2", secondId)).toBeUndefined();
  });
});

function fixtureResult(): JourneySearchResponse {
  return {
    serviceDate: "2026-08-25",
    originStation: "京都",
    destinationStation: "岡山",
    searchTimeMinutes: 480,
    totalMatchCount: 0,
    matches: [],
    journeys: [],
  };
}
