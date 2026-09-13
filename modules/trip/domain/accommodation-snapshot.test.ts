import { describe, expect, it } from "vitest";
import { validateAccommodationSnapshot, type AccommodationSnapshot } from "./accommodation-snapshot";
import { createTrip, applyTripProposal, type StayItineraryItem } from "./trip";
import { projectStaySchedule } from "./itinerary-schedule";

const at = "2026-09-12T08:00:00Z", id = "11111111-1111-4111-8111-111111111111";
function snapshot(): AccommodationSnapshot {
  return { provider: "products", providerItemId: "plan-1", selectedAt: at,
    place: { name: "宿", ref: { provider: "places", providerPlaceId: "facility-1" }, timeZone: "Europe/Vienna",
      sources: [{ id: "p", kind: "place", provider: "places", sourceId: "facility-1", retrievedAt: at, confidence: "observed" }] },
    checkInDate: "2026-09-22", checkOutDate: "2026-09-24",
    sources: [{ id: "s", kind: "accommodation", provider: "products", sourceId: "plan-1", retrievedAt: at, confidence: "observed" }] };
}
function item(a = snapshot()): StayItineraryItem {
  return { id: "stay", title: "宿泊", type: "stay", schedule: projectStaySchedule(a.checkInDate, a.checkOutDate, a.place.timeZone),
    selection: { status: "selected", accommodation: a } };
}
describe("AccommodationSnapshot contract", () => {
  it("keeps product identity independent from facility identity and projects exclusive day span", () => {
    const a = snapshot(); expect(() => validateAccommodationSnapshot(a)).not.toThrow();
    const trip = createTrip(id, "旅", at, [item(a)]);
    expect(trip.items[0]!.schedule).toEqual({ type: "day", date: "2026-09-22", endDate: "2026-09-24", timeZone: "Europe/Vienna" });
    expect(() => validateAccommodationSnapshot({ ...a, providerItemId: "another-plan", sources: a.sources.map((s) => ({ ...s, sourceId: "another-plan" })) })).not.toThrow();
  });
  it.each(["provider", "providerItemId", "place", "selectedAt", "checkInDate", "checkOutDate", "sources"])("requires %s", (key) => {
    const raw = { ...snapshot() } as unknown as Record<string, unknown>; delete raw[key];
    expect(() => validateAccommodationSnapshot(raw as unknown as AccommodationSnapshot)).toThrow();
  });
  it.each(["raw", "price", "currency", "availability", "bookingUrl", "image", "imageUrl", "review", "reviewAverage", "reservationStatus", "reservationReference", "unknown"])("rejects %s, even through Trip patch validation", (key) => {
    const a = { ...snapshot(), [key]: "not allowed" };
    expect(() => validateAccommodationSnapshot(a)).toThrow();
    const trip = createTrip(id, "旅", at, [item()]), before = structuredClone(trip);
    expect(() => applyTripProposal(trip, { tripId: id, baseRevision: 0, summary: "invalid", patches: [{ type: "replace", itemId: "stay", item: item(a) }] })).toThrow();
    expect(trip).toEqual(before);
  });
  it.each([
    { provider: "" }, { provider: "manual" }, { providerItemId: " " }, { selectedAt: "invalid" },
    { checkInDate: "2026-02-30" }, { checkOutDate: "2026-09-22" }, { checkOutDate: "2026-09-21" },
    { sources: [] }, { place: { name: "", sources: [] } }, { place: { name: "宿", sources: [], raw: {} } },
  ])("rejects invalid contract %j", (override) => {
    expect(() => validateAccommodationSnapshot({ ...snapshot(), ...override } as AccommodationSnapshot)).toThrow();
  });
  it.each([
    { provider: "wrong" }, { sourceId: "wrong" }, { sourceId: undefined }, { confidence: "unknown" }, { kind: "web" },
    { retrievedAt: "2026-09-12T08:01:00Z" }, { observedAt: "2026-09-12T08:01:00Z" },
    { validUntil: "2026-09-12T07:59:00Z" }, { validFrom: "2026-09-13T00:00:00Z" }, { raw: {} },
  ])("rejects mismatched or invalid source %j", (change) => {
    const a = snapshot(); expect(() => validateAccommodationSnapshot({ ...a, sources: [{ ...a.sources[0]!, ...change }] } as AccommodationSnapshot)).toThrow();
  });
  it("rejects independently edited schedule and newer place capture without mutating the plan", () => {
    const trip = createTrip(id, "旅", at, [item()]);
    for (const schedule of [{ type: "day", date: "2026-09-21", endDate: "2026-09-24", timeZone: "Europe/Vienna" },
      { type: "day", date: "2026-09-22", endDate: "2026-09-25", timeZone: "Europe/Vienna" },
      { type: "day", date: "2026-09-22", endDate: "2026-09-24" }, { type: "unscheduled" }] as const) {
      expect(() => createTrip(id, "旅", at, [{ ...item(), schedule }])).toThrow();
    }
    const a = snapshot(); expect(() => validateAccommodationSnapshot({ ...a, place: { ...a.place, capturedAt: "2026-09-13T00:00:00Z" } })).toThrow();
    expect(trip.items).toEqual([item()]);
  });
  it.each(["selection", "place", "schedule"] as const)("maintains rejected stay %s assumption atomically", (field) => {
    const trip = createTrip(id, "旅", at, [item()], { constraints: [], assumptions: [{ id: "a", text: "宿の仮案", source: "model", status: "unconfirmed", affects: [{ type: "item", itemId: "stay", field }] }] });
    const request = { ...trip.request, assumptions: trip.request.assumptions.map((a) => ({ ...a, status: "rejected" as const })) };
    expect(() => applyTripProposal(trip, { tripId: id, baseRevision: 0, summary: "reject", patches: [{ type: "request", request }] })).toThrow();
    const reverted: StayItineraryItem = { id: "stay", title: "宿泊", type: "stay", schedule: { type: "unscheduled" }, selection: { status: "unselected" } };
    const next = applyTripProposal(trip, { tripId: id, baseRevision: 0, summary: "reject", patches: [{ type: "request", request }, { type: "replace", itemId: "stay", item: reverted }] });
    expect(next.items[0]).toEqual(reverted); expect(trip.items[0]).toEqual(item());
  });
});
