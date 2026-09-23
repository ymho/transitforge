import { expect, it } from "vitest";
import { externalTravelEvidence } from "./external-travel-evidence";

const context = { executionId: "execution", toolCallId: "call", toolName: "search", queryFingerprint: "query-a", retrievedAt: "2026-09-23T00:00:00Z" };
it("keeps the same accommodation subject in distinct date/party observation scopes", () => {
  const output = { accommodations: [{ kind: "accommodation", provider: "provider", providerItemId: "hotel-1", name: "同名ホテル",
    checkInDate: "2026-10-01", checkOutDate: "2026-10-02", availability: "available" }] };
  const a = externalTravelEvidence(output, context)[0]!, b = externalTravelEvidence({ accommodations: [{ ...output.accommodations[0], checkInDate: "2026-10-03", checkOutDate: "2026-10-04", availability: "unknown" }] },
    { ...context, queryFingerprint: "query-b" })[0]!;
  expect(a.id).not.toBe(b.id); expect(a.observation?.subjectKey).toBe(b.observation?.subjectKey); expect(a.observation?.scopeKey).not.toBe(b.observation?.scopeKey);
});
it("normalizes Mapbox access and Place envelopes through the production evidence mapper", () => {
  const access = externalTravelEvidence({ groundAccess: { status: "available", freshness: "fresh", data: { origin: { entityId: "station:a" },
    destination: { entityId: "place:b" }, mode: "walking", durationMinutes: 14.2 }, evidence: [{ id: "route", provider: "mapbox", sourceUrl: "https://example.test/route" }] } }, context)[0]!;
  expect(access.applicabilityFacts?.[0]).toMatchObject({ kind: "access_requirement", lowerBoundMinutes: 15 });
  const place = externalTravelEvidence({ result: { status: "available", freshness: "fresh", data: { places: [{ providerPlaceId: "branch-a", name: "同名店", sourceUrl: "https://example.test/branch-a",
    targetBinding: { status: "resolved" }, summary: "紹介" }] }, evidence: [{ id: "place", provider: "mapbox", sourceUrl: "https://example.test/branch-a" }] } }, context)[0]!;
  expect(place.observation?.subjectKey).toBe("place:mapbox:branch-a"); expect(place.applicabilityFacts?.[0]).toMatchObject({ kind: "visit_requirement", reservation: "unknown" });
});
it("marks a truncated page as partial instead of treating the first 1200 chars as complete", () => {
  const text = "紹介".repeat(700) + "臨時休業";
  const evidence = externalTravelEvidence({ webPages: { status: "available", freshness: "fresh", data: { pages: [{ url: "https://example.test/page", title: "施設", text, truncated: true }] },
    evidence: [{ id: "page", provider: "safe-reader", sourceUrl: "https://example.test/page" }] } }, context)[0]!;
  expect(evidence.facts.sourceCoverage).toBe("partial"); expect(String(evidence.facts.sourceExcerpt)).not.toContain("臨時休業");
});
it("keeps generated Evidence IDs inside the Decision contract without collapsing distinct observations", () => {
  const long = { ...context, executionId: `candidate-${"long-scenario-".repeat(12)}`, toolCallId: `tooluse-${"x".repeat(40)}` };
  const output = { accommodations: [{ kind: "accommodation", provider: "provider", providerItemId: "hotel-1", name: "ホテル" }] };
  const first = externalTravelEvidence(output, long)[0]!;
  const second = externalTravelEvidence(output, { ...long, queryFingerprint: "query-b" })[0]!;
  expect(first.id.length).toBeLessThanOrEqual(160);
  expect(first.observation?.observationId).toBe(first.id);
  expect(second.id.length).toBeLessThanOrEqual(160);
  expect(second.id).not.toBe(first.id);
});
