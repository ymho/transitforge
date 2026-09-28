import { describe, expect, it } from "vitest";
import { applyTripProposal, createTrip, type TripUpdateProposal } from "./trip";

const at = "2026-09-12T08:00:00Z";
const trip = () => createTrip("75600000-0000-4000-8000-000000000001", "出雲", at, [
  { id: "shrine", title: "出雲大社", type: "activity", category: "sightseeing", schedule: { type: "day", date: "2026-10-01" },
    place: { name: "出雲大社", sources: [] } },
  { id: "meal", title: "昼食", type: "activity", category: "food", schedule: { type: "day", date: "2026-10-01" },
    place: { name: "食堂", sources: [] } },
]);
const proposal = (action: "confirm" | "withdraw", itemId = "shrine"): TripUpdateProposal => ({ tripId: trip().id,
  baseRevision: 0, summary: "明示選択", patches: [{ type: "item_decision", action, itemId }] });
const decision = (action: "confirm" | "withdraw", source = trip()) => {
  const p = { ...proposal(action), baseRevision: source.revision };
  return applyTripProposal(source, p, { clock: { now: () => new Date(at) }, confirmedItemDecision: JSON.stringify(p) });
};
describe("per-item decision", () => {
  it("only the selected item is confirmed, separate from Trip adoption and bookings", () => {
    const original = trip(), p = proposal("confirm");
    expect(() => applyTripProposal(original, p)).toThrow();
    const confirmed = decision("confirm");
    expect(confirmed.items[0]).toMatchObject({ decision: { confirmedAt: new Date(at).toISOString() } });
    expect(confirmed.items[1]).not.toHaveProperty("decision");
    expect(confirmed.adoption).toBeUndefined();
    expect(decision("withdraw", confirmed).items[0]).not.toHaveProperty("decision");
    expect(original.items[0]).not.toHaveProperty("decision");
  });
  it("marks only changed or moved confirmed items for review and rejects status injection", () => {
    const original = decision("confirm");
    const meal = original.items[1]!, shrine = original.items[0]!;
    const replacedMeal = applyTripProposal(original, { tripId: original.id, baseRevision: 0, summary: "昼食を変更", patches: [
      { type: "replace", itemId: meal.id, item: { ...meal, title: "別の昼食" } },
    ] });
    expect(replacedMeal.items[0]!.decision).toEqual(shrine.decision);
    const changed = applyTripProposal(original, { tripId: original.id, baseRevision: 0, summary: "参拝を変更", patches: [
      { type: "replace", itemId: shrine.id, item: { ...shrine, title: "別の参拝" } },
    ] });
    expect(changed.items[0]!.decision).toMatchObject({ needsReconfirmation: true });
    expect(changed.items[1]).not.toHaveProperty("decision");
    const moved = applyTripProposal(original, { tripId: original.id, baseRevision: 0, summary: "移動", patches: [
      { type: "move", itemId: shrine.id, afterId: meal.id },
    ] });
    expect(moved.items[1]!.decision).toMatchObject({ needsReconfirmation: true });
    expect(() => applyTripProposal(original, { tripId: original.id, baseRevision: 0, summary: "偽造", patches: [
      { type: "add", item: { ...meal, id: "injected", decision: { confirmedAt: at } } },
    ] })).toThrow();
    expect(() => applyTripProposal(original, { tripId: original.id, baseRevision: 0, summary: "偽造", patches: [
      { type: "replace", itemId: shrine.id, item: { ...shrine, decision: { confirmedAt: "2026-10-01T00:00:00Z" } } },
    ] })).toThrow();
  });
  it("does not confirm an unresolved hotel or an unspecified restaurant", () => {
    const current = createTrip(trip().id, "旅", at, [
      { id: "stay", title: "宿未定", type: "stay", selection: { status: "unselected" }, schedule: { type: "unscheduled" } },
      { id: "food", title: "夕食", type: "activity", category: "food", schedule: { type: "unscheduled" } },
    ]);
    for (const itemId of ["stay", "food"]) {
      const p = proposal("confirm", itemId);
      expect(() => applyTripProposal(current, p, { clock: { now: () => new Date(at) }, confirmedItemDecision: JSON.stringify(p) })).toThrow();
    }
  });
});
