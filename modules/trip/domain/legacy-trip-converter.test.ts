import { describe, expect, it } from "vitest";
import { convertLegacyTripPlan, type LegacyTripMigrationOptions } from "./legacy-trip-converter";
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
  it("maps legacy calendar dates without inventing fixed times, zones or Activity", () => {
    const plan = legacy();
    const sight = plan.items[2]!;
    const walk = plan.items[3]!;
    if (sight.type === "sightseeing") sight.date = "2020-09-22";
    if (walk.type === "movement" && walk.mode !== "rail") walk.date = "2026-09-22";
    const before = structuredClone(plan);
    const result = convertLegacyTripPlan(plan, identity);
    expect(result.trip.items.map(({ schedule }) => schedule)).toEqual([
      { type: "unscheduled" }, { type: "day", date: "2026-09-13", endDate: "2026-09-14" }, { type: "day", date: "2026-09-22" },
    ]);
    // Even when provider Place cannot be retained, the user's date is independently recoverable.
    expect(result.placeMappings).toEqual([{ itemId: "sight", schedule: { type: "day", date: "2020-09-22" } }]);
    expect(result.trip.items).toHaveLength(3);
    expect(result).toEqual(convertLegacyTripPlan(plan, identity));
    expect(plan).toEqual(before);
  });
  it("preserves a rail civil date but never treats serviceDate or a candidate time as adopted", () => {
    const plan = legacy();
    if (plan.items[0]!.type === "movement" && plan.items[0].mode === "rail") {
      plan.items[0].route.serviceDate = "2026-09-21";
      expect(convertLegacyTripPlan(plan, identity).trip.items[0]!.schedule).toEqual({ type: "unscheduled" });
      plan.items[0].route.departureDate = "2026-09-22";
      expect(convertLegacyTripPlan(plan, identity).trip.items[0]!.schedule).toEqual({ type: "day", date: "2026-09-22" });
    }
  });
  it.each(["2026-02-30", "", "tomorrow"])("quarantines invalid legacy schedule %s without correcting it", (date) => {
    const plan = legacy();
    for (const item of plan.items) {
      if (item.type === "stay") item.checkOutDate = date;
      else if (item.type === "movement" && item.mode === "rail") item.route.departureDate = date;
      else item.date = date;
    }
    const before = structuredClone(plan);
    const result = convertLegacyTripPlan(plan, identity);
    expect(result.trip.items.every(({ schedule }) => schedule.type === "unscheduled")).toBe(true);
    expect(result.placeMappings[0]!.schedule).toEqual({ type: "unscheduled" });
    expect(result.warnings.filter(({ code }) => code === "schedule-invalid")).toHaveLength(4);
    expect(result.requiresLegacyRetention).toBe(true);
    expect(plan).toEqual(before);
  });
  it.each(["wikipedia", "mapbox", "manual"] as const)("maps a retainable legacy %s place through the same converter", (provider) => {
    const plan: TripPlan = { ...legacy(), items: [{ id: "place", type: "sightseeing", place: {
      name: "見所", provider, ...(provider !== "manual" ? { placeId: "opaque:001" } : {}), coordinate: [135, 35],
    } }] };
    // Synthetic permission fixture; no claim that real Search Box data permits retention.
    const options: LegacyTripMigrationOptions = provider === "manual" ? {} : { placeRetentionByItemId: { place: {
      retention: { origin: "provider", provider, storage: "permitted", allowedFields: ["ref", "name", "coordinate", "sources"] },
      sources: [{ id: "legacy-evidence", kind: "place", provider, sourceId: "opaque:001", retrievedAt: "2025-01-01T00:00:00Z", confidence: "unknown" }],
    } } };
    const before = structuredClone({ plan, options });
    const result = convertLegacyTripPlan(plan, identity, options);
    expect(result.placeMappings).toEqual([{ itemId: "place", schedule: { type: "unscheduled" }, place: {
      ref: { provider, ...(provider !== "manual" ? { providerPlaceId: "opaque:001" } : {}) }, name: "見所",
      coordinate: { longitude: 135, latitude: 35 }, sources: options.placeRetentionByItemId?.place?.sources ?? [],
    } }]);
    expect(result.trip.items).toEqual([]); // Activity ownership stays #410.
    expect(result.deferredItemIds).toEqual(["place"]);
    expect(result).toEqual(convertLegacyTripPlan(plan, identity, options));
    expect({ plan, options }).toEqual(before);
    expect(result.placeMappings[0]!.place).not.toHaveProperty("capturedAt");
  });
  it.each(["mapbox", "wikipedia"] as const)("retains the original %s record instead of laundering unconfirmed provider data into manual", (provider) => {
    const plan: TripPlan = { ...legacy(), items: [{ id: "place", type: "sightseeing", place: { name: "Provider name", provider, placeId: "opaque", coordinate: [135, 35] } }] };
    const before = structuredClone(plan);
    const result = convertLegacyTripPlan(plan, identity);
    expect(result.placeMappings).toEqual([{ itemId: "place", schedule: { type: "unscheduled" } }]);
    expect(result.warnings).toContainEqual({ itemId: "place", code: "place-retention-unconfirmed", ownerIssue: 414 });
    expect(JSON.stringify(result)).not.toMatch(/Provider name|opaque|135/);
    expect(plan).toEqual(before);
    const denied = convertLegacyTripPlan(plan, identity, { placeRetentionByItemId: { place: {
      retention: { origin: "provider", provider, storage: "temporary", allowedFields: ["ref", "name", "sources"] }, sources: [],
    } } });
    expect(denied.placeMappings).toEqual([{ itemId: "place", schedule: { type: "unscheduled" } }]);
  });
  it("preserves a name-only manual place without fabricating missing values", () => {
    const plan: TripPlan = { ...legacy(), items: [{ id: "manual", type: "sightseeing", place: { provider: "manual", name: "広場" } }] };
    expect(convertLegacyTripPlan(plan, identity).placeMappings).toEqual([{ itemId: "manual", schedule: { type: "unscheduled" }, place: { ref: { provider: "manual" }, name: "広場", sources: [] } }]);
  });
  it("reports field restrictions instead of silently losing a provider ID or coordinate", () => {
    const plan: TripPlan = { ...legacy(), items: [{ id: "place", type: "sightseeing", place: {
      name: "施設", provider: "wikipedia", placeId: "opaque", coordinate: [135, 35],
    } }] };
    Object.assign(plan.items[0]!, { raw: "excluded" });
    const result = convertLegacyTripPlan(plan, identity, { placeRetentionByItemId: { place: {
      retention: { origin: "provider", provider: "wikipedia", storage: "permitted", allowedFields: ["name", "sources"] },
      sources: [{ id: "source", kind: "place", provider: "wikipedia", sourceId: "reviewed-catalog", retrievedAt: "2025-01-01T00:00:00Z", confidence: "unknown" }],
    } } });
    expect(result.placeMappings[0]!.place).toMatchObject({ name: "施設", sources: [{ confidence: "unknown" }] });
    expect(result.placeMappings[0]!.place).not.toHaveProperty("ref");
    expect(result.placeMappings[0]!.place).not.toHaveProperty("coordinate");
    expect(JSON.stringify(result)).not.toContain("excluded");
    expect(result.warnings).toContainEqual({ itemId: "place", code: "place-fields-not-retained", ownerIssue: 414 });
  });
  it.each([[999, 999], [NaN, 35], [135, Infinity], [35], [135, 35, 0]].map((coordinate) => ({ coordinate })))("quarantines invalid legacy coordinates $coordinate without clamping or dropping the whole plan", ({ coordinate }) => {
    const plan: TripPlan = { ...legacy(), items: [{ id: "manual", type: "sightseeing", place: { provider: "manual", name: "広場", coordinate: coordinate as [number, number] } }] };
    const before = structuredClone(plan);
    const result = convertLegacyTripPlan(plan, identity);
    expect(result.placeMappings[0]!.place).toEqual({ ref: { provider: "manual" }, name: "広場", sources: [] });
    expect(result.warnings).toContainEqual({ itemId: "manual", code: "place-coordinate-invalid", ownerIssue: 414 });
    expect(plan).toEqual(before);
  });
  it("reports invalid provider/identity without affecting other legacy items", () => {
    const plan = legacy();
    Object.assign(plan.items[2]!, { place: { provider: "unknown", name: "施設" } });
    const result = convertLegacyTripPlan(plan, identity);
    expect(result.trip.items).toHaveLength(3);
    expect(result.warnings).toContainEqual({ itemId: "sight", code: "place-invalid", ownerIssue: 414 });
  });
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
    for (const field of ["journeys", "options", "delay", "selectedAt", "verifiedAt", "planningState"]) expect(JSON.stringify(result.trip)).not.toContain(`"${field}`);
    expect(result.trip.request).toEqual({ constraints: [], assumptions: [] });
    expect(result.warnings.map(({ ownerIssue }) => ownerIssue)).toEqual(expect.arrayContaining([385, 400, 410, 413]));
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
