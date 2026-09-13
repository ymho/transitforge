import { describe, expect, it } from "vitest";
import { convertLegacyTripPlan } from "./legacy-trip-converter";
import type { TripPlan } from "./trip-plan";

const identity = { tripId: "11111111-1111-4111-8111-111111111111", createdAt: "2026-09-12T08:00:00Z" };
describe("legacy accommodation does not prove adoption", () => {
  it.each([false, true])("retains destination and dates but not options or provider facts: explicit=%s", (explicit) => {
    const accommodation = { name: "Provider宿", provider: "fixture", providerItemId: "hotel", address: "Provider住所", latitude: 35, longitude: 135,
      checkInDate: "2026-09-22", checkOutDate: "2026-09-24", price: { amount: 12000, currency: "JPY" as const, basis: "selected-dates" as const },
      availability: "available" as const, imageUrl: "https://example.com/image", bookingUrl: "https://example.com/book" };
    const plan: TripPlan = { version: 1, id: "legacy", title: "旅", destination: "京都", updatedAt: identity.createdAt,
      items: [{ id: "stay", type: "stay", destination: "京都", checkInDate: "2026-09-22", checkOutDate: "2026-09-24",
        ...(explicit ? { accommodation } : {}), options: [accommodation, { ...accommodation, name: "別の候補" }] }] };
    const before = structuredClone(plan), result = convertLegacyTripPlan(plan, identity);
    expect(result).toEqual(convertLegacyTripPlan(plan, identity)); expect(plan).toEqual(before);
    expect(result.trip.items[0]).toMatchObject({ id: "stay", schedule: { type: "day", date: "2026-09-22", endDate: "2026-09-24" },
      selection: { status: "unselected", place: { name: "京都", sources: [] } } });
    expect(JSON.stringify(result.trip)).not.toMatch(/Provider|hotel|price|availability|bookingUrl|imageUrl|coordinate|options|selectedAt/);
    expect(result.requiresLegacyRetention).toBe(true); expect(result.deferredItemIds).toContain("stay");
    expect(result).not.toHaveProperty("reservations");
    expect(JSON.stringify(result.trip)).not.toMatch(/booked|bookingReference|reservation/);
    expect(result.warnings).toContainEqual({ itemId: "stay", code: "stay-snapshot-deferred", ownerIssue: 400 });
    const invalid = structuredClone(plan); if (invalid.items[0]!.type === "stay") invalid.items[0].checkOutDate = "2026-02-30";
    expect(convertLegacyTripPlan(invalid, identity).trip.items[0]!.schedule.type).toBe("unscheduled");
  });
});
