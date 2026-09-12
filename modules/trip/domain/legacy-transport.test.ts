import { describe, it, expect } from "vitest";
import { convertLegacyTripPlan } from "./legacy-trip-converter";
import type { TripPlan, MovementMode } from "./trip-plan";
const identity = { tripId: "11111111-1111-4111-8111-111111111111", createdAt: "2026-09-12T08:00:00Z" };
const plan = (mode: Exclude<MovementMode, "rail">): TripPlan => ({ id: "legacy", version: 1, title: "旅", destination: "B", updatedAt: identity.createdAt,
  items: [{ id: "move", type: "movement", mode, origin: "A", destination: "B", date: "2026-09-22" }] });
describe("legacy manual movement mapping through the single converter", () => {
  it.each(["bus", "car", "rental-car", "walk", "other"] as const)("maps %s without guessing another mode, provider, or instant", (mode) => {
    const p = plan(mode), before = structuredClone(p), r = convertLegacyTripPlan(p, identity);
    expect(r.trip.items[0]).toEqual({ id: "move", title: "A → B", type: "transport", schedule: { type: "day", date: "2026-09-22" },
      detail: { status: "selected", mode, origin: { name: "A", sources: [] }, destination: { name: "B", sources: [] }, provenance: { type: "manual" } } });
    expect(r.warnings.some((w) => w.ownerIssue === 413)).toBe(false);
    expect(convertLegacyTripPlan(p, identity)).toEqual(r); expect(p).toEqual(before); expect(r.requiresLegacyRetention).toBe(true);
  });
  it("defers a note rather than appending it to the title or saving raw extra fields", () => {
    const p = plan("other"); Object.assign(p.items[0]!, { note: "飛行機かも", price: 99 });
    const before = structuredClone(p), r = convertLegacyTripPlan(p, identity);
    expect(r.trip.items[0]?.title).toBe("A → B"); expect(JSON.stringify(r.trip)).not.toMatch(/飛行機|price/);
    expect(r.deferredItemIds).toContain("move"); expect(r.warnings).toContainEqual({ itemId: "move", field: "note/extra", code: "transport-mode-deferred", ownerIssue: 413 });
    expect(p).toEqual(before);
  });
  it("retains partial movement/date failures without fabricating endpoints or dates", () => {
    const p = plan("bus"); Object.assign(p.items[0]!, { date: "2026-02-30", destination: "" });
    const r = convertLegacyTripPlan(p, identity);
    expect(r.trip.items[0]).toMatchObject({ schedule: { type: "unscheduled" }, detail: { status: "unresolved" } });
    expect(r.warnings.some((w) => w.code === "schedule-invalid")).toBe(true); expect(r.deferredItemIds).toContain("move");
  });
});
