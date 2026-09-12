import { describe, it, expect } from "vitest";
import { convertLegacyTripPlan } from "./legacy-trip-converter";
import type { TripPlan } from "./trip-plan";

const identity = { tripId: "11111111-1111-4111-8111-111111111111", createdAt: "2026-09-12T08:00:00Z" };
const plan: TripPlan = { id: "legacy", version: 1, title: "旅", destination: "", items: [], updatedAt: identity.createdAt };
const migrate = (conditions: unknown, companions?: unknown) => convertLegacyTripPlan({ ...plan, conditions } as TripPlan, identity,
  { tripContext: companions === undefined ? undefined : { companions } });
describe("party through the single legacy converter", () => {
  it.each([{ adults: 2 }, { adults: 2, children: 1 }, { adults: 0, children: 2 }])("maps counts without fabricating ages: %j", (counts) => {
    const conditions = { ...counts, considerations: ["海辺を散策"] }, before = structuredClone(conditions);
    const result = migrate(conditions);
    expect(result.trip.request.party).toEqual({ adults: counts.adults, children: Array.from({ length: counts.children ?? 0 }, () => ({})), source: "legacy", assumptionId: "legacy-assumption:party" });
    expect(result.trip.request.assumptions).toContainEqual(expect.objectContaining({ text: "海辺を散策", affects: [] }));
    expect(result.trip.request.assumptions).toContainEqual(expect.objectContaining({ source: "legacy", status: "unconfirmed", affects: [{ type: "party" }] }));
    expect(result.requiresLegacyRetention).toBe(true);
    expect(migrate(conditions)).toEqual(result); expect(conditions).toEqual(before);
  });
  it.each([-1, 1.5, NaN, Infinity, "2", Number.MAX_SAFE_INTEGER + 1])("warns, never clamps invalid counts: %j", (value) => {
    for (const conditions of [{ adults: value, children: 1 }, { adults: 2, children: value }]) {
      const result = migrate(conditions);
      expect(result.trip.request.party).toBeUndefined();
      expect(result.warnings).toContainEqual({ field: "conditions.party", code: "request-field-invalid", ownerIssue: 411 });
    }
  });
  it("defers enormous untrusted count-to-array allocations without changing Domain limits", () => {
    const result = migrate({ adults: 2, children: 10_001 });
    expect(result.trip.request.party).toBeUndefined();
    expect(result.warnings).toContainEqual({ field: "conditions.children", code: "request-field-deferred", ownerIssue: 411 });
  });
  it("retains composition-only as an unconfirmed note; does not infer two adults", () => {
    const result = migrate(undefined, ["partner"]);
    expect(result.trip.request.party).toBeUndefined();
    expect(result.trip.request.assumptions).toContainEqual(expect.objectContaining({ source: "legacy", status: "unconfirmed", text: expect.stringContaining("partner") }));
  });
  it("combines explicit counts with valid composition, rejecting contradictions without losing counts", () => {
    const result = migrate({ adults: 2, children: 1 }, ["family"]);
    expect(result.trip.request.party).toMatchObject({ adults: 2, children: [{}], composition: ["family"] });
    const inconsistent = migrate({ adults: 2, children: 1 }, ["solo"]);
    expect(inconsistent.trip.request.party?.composition).toBeUndefined();
    expect(inconsistent.trip.request.party?.adults).toBe(2);
    expect(inconsistent.warnings).toContainEqual({ field: "companions", code: "request-field-invalid", ownerIssue: 411 });
  });
  it("never accepts profile data as a migration party source", () => {
    const result = convertLegacyTripPlan(plan, identity, { tripContext: { profile: { companions: { usual: ["family"], children: [{ ageGroup: "baby" }] } } } });
    expect(result.trip.request.party).toBeUndefined();
    expect(result.warnings).toContainEqual({ field: "profile", code: "request-field-deferred", ownerIssue: 387 });
  });
});
