import { describe, expect, it } from "vitest";
import { convertLegacyTripPlan } from "./legacy-trip-converter";
import { assessTripTime } from "./trip-temporal";
import type { TripPlan } from "./trip-plan";

const identity = { tripId: "11111111-1111-4111-8111-111111111111", createdAt: "2026-09-12T00:00:00Z" };
const plan: TripPlan = { id: "legacy", version: 1, title: "去年の旅", destination: "ザルツブルク", updatedAt: "2025-09-22T00:00:00Z",
  items: [{ id: "travel", type: "movement", mode: "walk", date: "2025-09-22", origin: "A", destination: "B" }] };
describe("legacy state through the single Trip converter", () => {
  it.each([
    ["inspiration", true, "inspiration"], ["inspiration", false, "inspiration"],
    ["planning", true, "itinerary_draft"], ["planning", false, "candidate_discovery"],
    ["ready", true, "inspiration"], [42, true, "inspiration"], [null, true, "inspiration"], [undefined, true, "inspiration"],
  ])("maps stage %s, items %s without inventing progress", (stage, hasItems, expected) => {
    const original = { ...plan, items: hasItems ? plan.items : [] };
    const options = { tripContext: { planningStage: stage, startDate: "2025-09-22" } };
    const before = structuredClone({ original, options });
    const result = convertLegacyTripPlan(original, identity, options);
    expect(result.trip.planningState).toBe(expected);
    expect(result.trip.lifecycleState).toBe("pre_trip");
    expect(result.requiresLegacyRetention).toBe(true);
    expect(result.warnings).toContainEqual({ field: "lifecycleState", code: "lifecycle-unverified", ownerIssue: 383 });
    if (stage !== "planning" && stage !== "inspiration") expect(result.warnings).toContainEqual({ field: "planningStage", code: "planning-state-unresolved", ownerIssue: 383 });
    expect(result).toEqual(convertLegacyTripPlan(original, identity, options));
    expect({ original, options }).toEqual(before);
    expect(JSON.stringify(result.trip.request)).not.toContain("planningStage");
  });
  it("never rolls last year's September 22 into this year's future (old #380 regression)", () => {
    const result = convertLegacyTripPlan(plan, identity, { tripContext: { planningStage: "planning", startDate: "2025-09-22" } });
    const trip = result.trip;
    expect(trip.items[0]!.schedule).toEqual({ type: "day", date: "2025-09-22" });
    const clock = { now: () => new Date("2026-09-12T00:00:00Z") };
    // Missing legacy timezone is unknown, not a future schedule with a guessed timezone/year.
    expect(assessTripTime(trip, clock).position).toBe("unknown");
    const withExplicitZone = { ...trip, items: trip.items.map((i) => ({ ...i, schedule: { type: "day" as const, date: "2025-09-22", timeZone: "Europe/Vienna" } })) };
    expect(assessTripTime(withExplicitZone, clock).position).toBe("past");
    expect(assessTripTime(withExplicitZone, clock).suggestedLifecycle).toBeUndefined();
    expect(JSON.stringify(trip)).not.toContain("2026-09-22");
    expect(plan.items[0]).toMatchObject({ date: "2025-09-22" });
  });
});
