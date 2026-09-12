import { describe, it, expect } from "vitest";
import { createTrip, validateTrip, type TransportItineraryItem } from "./trip";
import { nonRailTransportModes } from "./transport-detail";
import { requestRailItem, requestConstraint } from "./trip-request.fixture";
import { evaluateTripHardConstraints } from "./trip-constraint-evaluation";
import type { MobilityRequirement } from "./trip-requirement";

const id = "11111111-1111-4111-8111-111111111111", at = "2026-09-12T08:00:00Z";
const item = (): TransportItineraryItem => ({ id: "move", title: "空港へ", type: "transport", schedule: { type: "unscheduled" },
  detail: { status: "selected", mode: "air", origin: { name: "東京", sources: [] }, destination: { name: "札幌", sources: [] }, provenance: { type: "manual" } } });
const trip = (i = item()) => createTrip(id, "旅", at, [i]);
const startAt = { at: "2026-09-22T08:00:00+09:00", timeZone: "Asia/Tokyo" }, endAt = { ...startAt, at: "2026-09-22T08:30:00+09:00" };
describe("Trip V2 general transport", () => {
  it.each(nonRailTransportModes)("retains manual %s and name-only places without any API", (mode) => {
    const i = item(); if (i.detail.status !== "selected" || i.detail.mode === "rail") throw new Error("fixture");
    expect(trip({ ...i, detail: { ...i.detail, mode } }).items[0]).toEqual({ ...i, detail: { ...i.detail, mode } });
  });
  it("keeps rail selected and fixed schedule validation", () => {
    expect(() => trip(requestRailItem())).not.toThrow();
    expect(() => trip({ ...requestRailItem(), schedule: { type: "unscheduled" } })).toThrow();
  });
  it.each(["mode", "extra", "origin", "destination", "place", "schedule", "realtime", "manual-provider"])("rejects %s", (bad) => {
    const i = item();
    if (bad === "mode") Object.assign(i.detail, { mode: "teleport" });
    if (bad === "extra") Object.assign(i, { price: 100 });
    if (bad === "origin") Object.assign(i.detail, { origin: undefined });
    if (bad === "destination") Object.assign(i.detail, { destination: undefined });
    if (bad === "place") Object.assign(i.detail, { origin: { name: "X", coordinate: { longitude: 181, latitude: 0 }, sources: [] } });
    if (bad === "schedule") Object.assign(i, { schedule: { type: "day", date: "2026-02-30" } });
    if (bad === "realtime") Object.assign(i.detail, { delayMinutes: 3, departureAt: at });
    if (bad === "manual-provider") Object.assign(i.detail, { origin: { name: "X", ref: { provider: "fake", providerPlaceId: "1" }, sources: [] } });
    expect(() => trip(i)).toThrow();
  });
  it.each(["schedule", "place", "selection"] as const)("uses existing %s assumptions without a new DSL", (field) => {
    const assumption = { id: "a", source: "model" as const, status: "unconfirmed" as const, text: "仮置き", affects: [{ type: "item" as const, itemId: "move", field }] };
    const t = { ...trip(), request: { constraints: [], assumptions: [assumption] } };
    expect(() => validateTrip(t)).not.toThrow();
    const rejected = { ...t, request: { constraints: [], assumptions: [{ ...assumption, status: "rejected" as const }] } };
    if (field === "schedule") expect(() => validateTrip(rejected)).not.toThrow();
    else {
      expect(() => validateTrip(rejected)).toThrow();
      expect(() => validateTrip({ ...rejected, items: [{ ...item(), detail: { status: "unresolved", mode: "air" } }] })).not.toThrow();
    }
  });
});

describe("non-rail hard mobility predicates", () => {
  const evaluate = (r: MobilityRequirement, items: TransportItineraryItem[] = [item()]) =>
    evaluateTripHardConstraints(createTrip(id, "旅", at, items, { constraints: [requestConstraint(r)], assumptions: [] }))[0]!.status;
  it.each([
    [{ type: "mobility", modes: ["air"] }, "satisfied"],
    [{ type: "mobility", excludedModes: ["air"] }, "violated"],
    [{ type: "mobility", requiredModes: ["rental-car"] }, "violated"],
    [{ type: "mobility", maxTransfers: 0 }, "unknown"],
    [{ type: "mobility", requiredTrainNumbers: ["1M"] }, "unknown"],
    [{ type: "mobility", excludedServiceUids: ["s1"] }, "unknown"],
  ] as const)("evaluates %j as %s", (r, expected) => expect(evaluate(r as MobilityRequirement)).toBe(expected));
  it("checks required modes across the scoped sequence, not every item independently", () => {
    const i = item(); if (i.detail.status !== "selected" || i.detail.mode === "rail") throw new Error("fixture");
    const car = { ...i, id: "car", detail: { ...i.detail, mode: "rental-car" as const } };
    expect(evaluate({ type: "mobility", requiredModes: ["air", "rental-car"] }, [i, car])).toBe("satisfied");
    expect(evaluate({ type: "mobility", requiredModes: ["rental-car"] }, [{ ...i, detail: { status: "unresolved", mode: "rental-car" } }])).toBe("unknown");
  });
  it("only evaluates elapsed fixed time with both endpoints, never treats a window as duration", () => {
    const i = item();
    expect(evaluate({ type: "mobility", maxTravelMinutes: 30 }, [{ ...i, schedule: { type: "fixed", startAt, endAt } }])).toBe("satisfied");
    expect(evaluate({ type: "mobility", maxTravelMinutes: 29 }, [{ ...i, schedule: { type: "fixed", startAt, endAt } }])).toBe("violated");
    for (const schedule of [{ type: "window", earliestStart: startAt, latestEnd: endAt, durationMinutes: 20 }, { type: "fixed", startAt }, { type: "day", date: "2026-09-22" }, { type: "unscheduled" }] as const) {
      expect(evaluate({ type: "mobility", maxTravelMinutes: 30 }, [{ ...i, schedule }])).toBe("unknown");
    }
  });
  it("requires resolved endpoint identity for non-rail arrival and does not hide an unknown final endpoint", () => {
    const source = { id: "s", kind: "timetable" as const, provider: "fixture", sourceId: "service", retrievedAt: at, confidence: "provider-schedule" as const };
    const place = { name: "空港", ref: { provider: "fixture", providerPlaceId: "airport" }, sources: [source] };
    const known: TransportItineraryItem = { ...item(), schedule: { type: "fixed", startAt, endAt }, detail: {
      status: "selected", mode: "air", origin: place, destination: place, provenance: { type: "provider", provider: "fixture", providerItemId: "service", selectedAt: at, sources: [source] },
    } };
    const status = (items: TransportItineraryItem[]) => evaluateTripHardConstraints(createTrip(id, "旅", at, items, {
      assumptions: [], constraints: [requestConstraint({ type: "arrive_by", place, at: endAt })],
    }))[0]!.status;
    expect(status([known])).toBe("satisfied");
    expect(status([{ ...known, schedule: { type: "unscheduled" } }])).toBe("unknown");
    expect(status([known, { ...item(), id: "unknown-final" }])).toBe("unknown");
  });
});
