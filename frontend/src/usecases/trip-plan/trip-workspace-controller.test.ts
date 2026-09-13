import { describe, expect, it } from "vitest";
import { applyTripProposal } from "@raiquora/trip/trip";
import { multiCityTrip } from "../../../../modules/trip/domain/trip-places.fixture";
import { createTripWorkspaceController } from "./trip-workspace-controller";
import { proposeManualActivity } from "./propose-trip-activity";
import { railSelectionFixture } from "../../../../modules/trip/domain/selected-rail-journey.fixture";
import { createTravelCandidate } from "@raiquora/trip/travel-candidate";
import { createTrip } from "@raiquora/trip/trip";
import type { CandidateSelectionPort } from "./select-trip-candidate";

describe("Trip workspace read/proposal host", () => {
  it("candidate ID resolves through verified selection, and async session switches reject stale results", async () => {
    const f = railSelectionFixture();
    const trip = createTrip("11111111-1111-4111-8111-111111111111", "旅", f.selectedAt, [{ id: "rail", title: "移動", type: "transport", detail: { mode: "rail", status: "unresolved" }, schedule: { type: "unscheduled" } }]);
    const record = { candidate: createTravelCandidate({ id: "candidate-a", journey: f.candidate.journey }), rail: f.candidate, tripId: trip.id, taskId: "task", validUntil: "2026-09-13T00:00:00Z" };
    const ids: string[] = [];
    const port: CandidateSelectionPort = { resolve: async (id) => { ids.push(id); return id === record.candidate.id ? record : undefined; }, loadTimetables: async () => f.inputs };
    const c = createTripWorkspaceController("one"); c.attach("one", { getCurrentTrip: () => trip, candidateSelection: { taskId: "task", port } });
    await c.selectCandidate("candidate-a", "rail", undefined, f.selectedAt);
    expect(ids).toEqual(["candidate-a"]); expect(c.proposal()?.patches[0]).toMatchObject({ type: "replace", itemId: "rail", item: { detail: { status: "selected" } } });
    expect(trip.items[0]).toMatchObject({ detail: { status: "unresolved" } });
    const pending = c.selectCandidate("candidate-a", "rail", undefined, f.selectedAt); c.activateSession("two");
    await expect(pending).rejects.toThrow(); expect(c.proposal()).toBeUndefined();
    c.activateSession("one"); await expect(c.selectCandidate("missing", "rail", undefined, f.selectedAt)).rejects.toThrow();
  });
  it("does not double-confirm or clear a newer proposal after a delayed host reply", async () => {
    const trip = multiCityTrip(); const c = createTripWorkspaceController("one"); let finish!: () => void;
    c.attach("one", { getCurrentTrip: () => trip, confirmProposal: () => new Promise<void>((resolve) => { finish = resolve; }) });
    c.propose("最初", [{ type: "move", itemId: "activity" }]); const confirmation = c.confirm();
    await expect(c.confirm()).rejects.toThrow(); c.propose("次", [{ type: "remove", itemId: "activity" }]);
    finish(); await confirmation; expect(c.proposal()?.summary).toBe("次");
  });
  it("does not infer a V2 source from legacy or mutate a Trip on selection/preview", () => {
    const c = createTripWorkspaceController("one"); expect(c.current()).toBeUndefined();
    const trip = multiCityTrip(), original = structuredClone(trip);
    c.attach("one", { getCurrentTrip: () => trip }); c.focus("activity");
    c.propose("順序の案", [{ type: "move", itemId: "activity" }]);
    expect(c.current()).toBe(trip); expect(trip).toEqual(original); expect(c.canConfirm()).toBe(false);
    expect(c.uiFocus()).toEqual({ itemId: "activity" });
    c.activateSession("two"); expect(c.current()).toBeUndefined(); expect(c.proposal()).toBeUndefined(); expect(c.uiFocus()).toBeUndefined();
    c.activateSession("one"); expect(c.proposal()?.summary).toBe("順序の案"); expect(c.uiFocus()?.itemId).toBe("activity");
  });
  it("requires an explicit confirmation host and rejects stale/invalid proposals", async () => {
    let trip = multiCityTrip(); const c = createTripWorkspaceController("one");
    c.attach("one", { getCurrentTrip: () => trip, confirmProposal: async (p) => { trip = applyTripProposal(trip, p); } });
    expect(() => c.propose("不正", [{ type: "remove", itemId: "missing" }])).toThrow();
    c.propose("移動", [{ type: "move", itemId: "activity" }]);
    await c.confirm(); expect(trip.items[0]?.id).toBe("activity"); expect(c.proposal()).toBeUndefined();
    c.propose("削除", [{ type: "remove", itemId: "activity" }]); trip = { ...trip, title: "別の変更" };
    await expect(c.confirm()).rejects.toThrow(); expect(trip.items).toHaveLength(3);
  });
  it("does not expose a deleted/unknown focus or reuse another session's proposal", () => {
    let trip = multiCityTrip(); const c = createTripWorkspaceController("one");
    c.attach("one", { getCurrentTrip: () => trip }); expect(() => c.focus("missing")).toThrow(); c.focus("activity");
    trip = { ...trip, items: trip.items.filter((i) => i.id !== "activity") }; expect(c.uiFocus()).toBeUndefined();
    c.activateSession("two"); expect(() => c.propose("移動", [])).toThrow();
  });
  it("refines an Activity without dropping its retained provider place", () => {
    const trip = multiCityTrip(), before = structuredClone(trip);
    const proposal = proposeManualActivity(trip, { itemId: "activity", operation: "replace" }, { title: "ゆっくり散策", category: "sightseeing", schedule: { type: "day", date: "2026-09-24" } });
    const after = applyTripProposal(trip, proposal);
    expect(after.items[2]).toMatchObject({ id: "activity", place: (trip.items[2] as { place: unknown }).place });
    expect(after.items.slice(0, 2)).toEqual(trip.items.slice(0, 2)); expect(trip).toEqual(before);
  });
});
