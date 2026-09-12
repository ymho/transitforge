import { describe, expect, it } from "vitest";
import { createTrip, validateTrip, type Trip } from "./trip";

const id = "11111111-1111-4111-8111-111111111111";
const at = "2026-09-12T08:00:00Z";
describe("minimal Trip V2", () => {
  it("creates an inspiration/pre-trip plan without inventing constraints or schedules", () => {
    expect(createTrip(id, "旅", at)).toEqual({ id, title: "旅", schemaVersion: 2, revision: 0, createdAt: at, updatedAt: at, items: [], request: { constraints: [], assumptions: [] }, planningState: "inspiration", lifecycleState: "pre_trip" });
  });
  it("does not retain caller-owned item references", () => {
    const item = { id: "stay", title: "宿", type: "stay" as const, schedule: { type: "unscheduled" as const }, selection: { status: "unselected" as const } };
    const trip = createTrip(id, "旅", at, [item]);
    item.title = "changed";
    expect(trip.items[0]!.title).toBe("宿");
  });
  it("can keep an unresolved manual place in Trip without treating it as a selected hotel", () => {
    const place = { name: "海辺の宿", sources: [] };
    const item = { id: "stay", type: "stay" as const, title: "宿", schedule: { type: "unscheduled" as const }, selection: { status: "unselected" as const, place } };
    const trip = createTrip(id, "旅", at, [item]);
    expect(trip.items[0]).toEqual(item);
    place.name = "変更";
    expect(trip.items[0]).toMatchObject({ selection: { status: "unselected", place: { name: "海辺の宿" } } });
    Object.assign(place, { raw: true });
    expect(() => createTrip(id, "旅", at, [item])).toThrow();
  });
  it.each([
    { id: "session-not-a-uuid" }, { schemaVersion: 3 }, { revision: -1 }, { revision: 0.5 },
    { createdAt: "2026-02-30T00:00:00Z" }, { updatedAt: "2025-01-01T00:00:00Z" }, { journeys: [] },
  ])("rejects invalid metadata / unknown schema keys: %j", (override) => {
    expect(() => validateTrip({ ...createTrip(id, "旅", at), ...override } as Trip)).toThrow();
  });
  it("rejects duplicate IDs and a stay candidate list at the Trip boundary", () => {
    const item = { id: "stay", title: "宿", type: "stay" as const, schedule: { type: "unscheduled" as const }, selection: { status: "unselected" as const } };
    expect(() => createTrip(id, "旅", at, [item, item])).toThrow();
    expect(() => createTrip(id, "旅", at, [{ ...item, options: [] } as typeof item])).toThrow();
  });
});
