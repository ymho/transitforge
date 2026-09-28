import { describe, expect, it } from "vitest";
import { purposeDiscoveryFacets, purposeTravelOutcome } from "./purpose-travel-tools.js";

describe("purpose travel tools", () => {
  it("turns a concrete destination and an experience request into typed facets without classifying prose", () => {
    expect(purposeDiscoveryFacets("explore_destination", { destination: "出雲大社", interests: ["歴史"], includeNearby: true }))
      .toEqual([{ kind: "place", value: "出雲大社" }, { kind: "activity", value: "歴史" },
        { kind: "soft_preference", value: "周辺の立ち寄り候補" }]);
    expect(purposeDiscoveryFacets("discover_destinations", { experiences: ["歴史ある町歩き", "美味しいもの"], preferredAreas: ["中国地方"], season: "秋" }))
      .toEqual([{ kind: "area", value: "中国地方" }, { kind: "activity", value: "歴史ある町歩き" },
        { kind: "activity", value: "美味しいもの" }, { kind: "season", value: "秋" }]);
  });

  it.each([
    ["no_candidates", { discovery: { batch: { hits: [], coverage: { completedQueries: 2 }, incompleteReasons: [] } }, verifiedCandidateCount: 0, photoCandidateCount: 0, sourceReadFailed: false, placeEnrichmentFailed: false }],
    ["failed", { discovery: { batch: { hits: [], coverage: { completedQueries: 0 }, incompleteReasons: ["retrieval_failed:web"] } }, verifiedCandidateCount: 0, photoCandidateCount: 0, sourceReadFailed: false, placeEnrichmentFailed: false }],
    ["partial", { discovery: { batch: { hits: [{}], coverage: { completedQueries: 1 }, incompleteReasons: [] } }, verifiedCandidateCount: 1, photoCandidateCount: 0, sourceReadFailed: false, placeEnrichmentFailed: true }],
    ["complete", { discovery: { batch: { hits: [{}], coverage: { completedQueries: 1 }, incompleteReasons: [] } }, verifiedCandidateCount: 2, photoCandidateCount: 1, sourceReadFailed: false, placeEnrichmentFailed: false }],
  ] as const)("keeps %s distinct", (status, input) => {
    expect(purposeTravelOutcome({ requestedCandidates: status === "complete" ? "multiple" : "one", ...input }).status).toBe(status);
  });
});
