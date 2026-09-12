import { describe, expect, it } from "vitest";
import { convertLegacyTripPlan } from "./legacy-trip-converter";
import type { TripPlan } from "./trip-plan";
import { railSelectionFixture } from "./selected-rail-journey.fixture";

const identity = { tripId: "11111111-1111-4111-8111-111111111111", createdAt: "2026-09-12T08:00:00Z" };
function legacy(): TripPlan {
  return { version: 1, id: "legacy-session-plan", title: "旅", destination: "C", updatedAt: "2025-01-01T00:00:00Z", items: [
    { id: "rail", type: "movement", mode: "rail", route: { originStation: "A", destinationStation: "B", journeys: [railSelectionFixture().candidate.journey, railSelectionFixture().candidate.journey] } },
    { id: "hotel", type: "stay", destination: "B", checkInDate: "2026-09-13", checkOutDate: "2026-09-14",
      options: ["宿A", "宿B"].map((name) => ({ name, checkInDate: "2026-09-13", checkOutDate: "2026-09-14" })) },
    { id: "sight", type: "sightseeing", place: { provider: "wikipedia", name: "見所" } },
    { id: "walk", type: "movement", mode: "walk", origin: "A", destination: "B" },
  ] };
}
describe("single legacy converter", () => {
  it("is deterministic, retains IDs and reports deferred mappings without copying candidates", () => {
    const plan = legacy(); const before = structuredClone(plan);
    const result = convertLegacyTripPlan(plan, identity);
    expect(result).toEqual(convertLegacyTripPlan(plan, identity));
    expect(plan).toEqual(before);
    expect(result.trip).toMatchObject({ id: identity.tripId, schemaVersion: 2, revision: 0,
      items: [{ id: "rail", detail: { mode: "rail", status: "unresolved" } },
        { id: "hotel", selection: { status: "unselected" } }, { id: "walk", detail: { status: "unresolved" } }] });
    expect(result.deferredItemIds).toEqual(["sight"]);
    expect(result.requiresLegacyRetention).toBe(true);
    for (const field of ["journeys", "options", "delay", "selectedAt", "verifiedAt", "planningState", "request", "schedule"]) expect(JSON.stringify(result.trip)).not.toContain(`"${field}`);
    expect(result.warnings.map(({ ownerIssue }) => ownerIssue)).toEqual(expect.arrayContaining([385, 386, 387, 400, 410, 413]));
  });
  it("does not adopt even one legacy journey or an explicit hotel without snapshot provenance", () => {
    const plan = legacy();
    if (plan.items[0]!.type === "movement" && plan.items[0].mode === "rail") plan.items[0].route.journeys = [railSelectionFixture().candidate.journey];
    if (plan.items[1]!.type === "stay") plan.items[1].accommodation = plan.items[1].options![0];
    const result = convertLegacyTripPlan(plan, identity);
    expect(result.trip.items[0]).toMatchObject({ detail: { status: "unresolved" } });
    expect(result.trip.items[1]).toMatchObject({ selection: { status: "unselected" } });
  });
  it("rejects unsupported version and duplicate IDs without touching legacy input", () => {
    const plan = legacy(); plan.items.push(structuredClone(plan.items[0]!)); const before = structuredClone(plan);
    expect(() => convertLegacyTripPlan(plan, identity)).toThrow(); expect(plan).toEqual(before);
    expect(() => convertLegacyTripPlan({ ...legacy(), version: 3 } as unknown as TripPlan, identity)).toThrow();
  });
});
