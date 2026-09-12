import { describe, expect, it } from "vitest";
import { convertLegacyTripPlan } from "./legacy-trip-converter";
import type { TripPlan } from "./trip-plan";
import { validateTrip } from "./trip";

const identity = { tripId: "11111111-1111-4111-8111-111111111111", createdAt: "2026-09-12T08:00:00Z" };
const plan: TripPlan = { version: 1, id: "legacy", title: "旅", destination: "出雲", updatedAt: "2020-09-01T00:00:00Z", items: [],
  conditions: { adults: 1, children: 0, considerations: ["ゆっくり巡りたい"] } };
describe("legacy request mapping at the single converter", () => {
  it("retains meaningful conditions without claiming user/profile authorship, certainty or strength", () => {
    const context = { destinationWish: "出雲大社", startDate: "2020-09-21", endDate: "2020-09-23", stayNights: 2, interests: { history: 0.8 },
      avoidances: ["混雑"], pace: 0.3, maximumTravelMinutes: 180, carAvailable: false, adventureIntensity: 1, avoidedRisks: ["night-isolation"],
      planningStage: "planning", companions: ["solo"], outboundDepartureTimeMinutes: 540, returnArrivalTimeMinutes: 1260, relativeDistancePreference: "nearer" };
    const before = structuredClone({ plan, context });
    const result = convertLegacyTripPlan(plan, identity, { tripContext: context });
    expect(() => validateTrip(result.trip)).not.toThrow();
    expect(result.trip.request.constraints.map((c) => c.requirement)).toEqual(expect.arrayContaining([
      { type: "dates", start: { earliest: "2020-09-21", latest: "2020-09-21" }, end: { earliest: "2020-09-23", latest: "2020-09-23" } },
      { type: "duration", unit: "nights", minimum: 2, maximum: 2 },
      { type: "destinations", places: [{ name: "出雲大社", sources: [] }], order: "flexible" },
      { type: "pace", value: 0.3 }, { type: "mobility", maxTravelMinutes: 180 }, { type: "mobility", carAvailable: false },
      { type: "experience", intent: "prefer", preference: "history", text: "歴史", weight: 0.8 },
      { type: "experience", intent: "avoid", text: "混雑" },
    ]));
    expect(result.trip.request.constraints.every((c) => c.source === "legacy" && c.assumptionId && c.strength === "soft")).toBe(true);
    expect(result.trip.request.assumptions.every((a) => a.source === "legacy" && a.status === "unconfirmed")).toBe(true);
    expect(result.trip.request.assumptions).toContainEqual(expect.objectContaining({ text: "ゆっくり巡りたい", affects: [] }));
    expect(result.trip.request.party).toMatchObject({ adults: 1, children: [], composition: ["solo"], source: "legacy" });
    expect(result.trip.planningState).toBe("candidate_discovery");
    expect(result.trip.request.constraints.some((c) => ["arrive_by", "depart_after", "relative_distance"].includes(c.requirement.type))).toBe(false);
    expect(result.requiresLegacyRetention).toBe(true);
    expect(result).toEqual(convertLegacyTripPlan(plan, identity, { tripContext: context }));
    expect({ plan, context }).toEqual(before);
    expect(result.trip.request.constraints).toEqual(convertLegacyTripPlan(plan, identity, { tripContext: Object.fromEntries(Object.entries(context).reverse()) }).trip.request.constraints);
  });
  it.each([null, [], "invalid", { startDate: "2026-02-30", stayNights: -1, pace: 2, carAvailable: "false", maximumTravelMinutes: NaN,
    interests: { history: 4, imaginary: 0.9 }, avoidances: [null], arbitrary: "not interpreted" }])("quarantines malformed raw input: %j", (context) => {
    const before = structuredClone(context);
    const result = convertLegacyTripPlan(plan, identity, { tripContext: context });
    expect(result.trip.request.constraints).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.requiresLegacyRetention).toBe(true);
    expect(context).toEqual(before);
  });
  it("keeps valid start even with invalid end; never defaults missing nights to day-trip", () => {
    const result = convertLegacyTripPlan(plan, identity, { tripContext: { startDate: "2020-01-01", endDate: "nonsense", maximumTravelMinutes: null } });
    expect(result.trip.request.constraints.map((c) => c.requirement)).toEqual([{ type: "dates", start: { earliest: "2020-01-01", latest: "2020-01-01" } }]);
    expect(result.warnings).toContainEqual({ field: "endDate", code: "request-field-invalid", ownerIssue: 387 });
    expect(convertLegacyTripPlan(plan, identity, { tripContext: { stayNights: 0 } }).trip.request.constraints[0]!.requirement).toEqual({ type: "duration", unit: "nights", minimum: 0, maximum: 0 });
    expect(convertLegacyTripPlan(plan, identity, { tripContext: { endDate: "2020-01-03" } }).trip.request.constraints).toEqual([]);
  });
});
