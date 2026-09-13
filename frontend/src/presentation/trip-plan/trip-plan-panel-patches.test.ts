// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import type { TripPlan } from "@raiquora/trip/trip-plan";
import { configureTripPlanPanel } from "./trip-plan-panel";
import { loadTripPlan } from "../../usecases/trip-plan/trip-plan-repository";
import { createTripWorkspaceController } from "../../usecases/trip-plan/trip-workspace-controller";

it("does not save or render a partial invalid proposal, but applies a valid proposal", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(), key: () => null, length: 0,
  } satisfies Storage;
  const content = document.createElement("div");
  const controller = configureTripPlanPanel(document.createElement("div"), content,
    document.createElement("button"), document.createElement("button"), "session", vi.fn(), storage);
  const plan: TripPlan = {
    version: 1, id: "trip", title: "元の旅", destination: "出雲", updatedAt: "2026-09-12",
    items: [{ id: "a", type: "sightseeing", place: { name: "出雲大社", provider: "manual" } }],
  };
  controller.show(plan);
  storage.setItem.mockClear();
  const rendered = content.innerHTML;
  controller.apply([
    { type: "metadata", title: "適用しない" },
    { type: "replace", itemId: "missing", item: plan.items[0] },
  ]);
  expect(storage.setItem).not.toHaveBeenCalled();
  expect(loadTripPlan(storage, "session")).toEqual(plan);
  expect(content.innerHTML).toBe(rendered);
  controller.apply([{ type: "metadata", title: "新しい旅" }]);
  expect(storage.setItem).toHaveBeenCalledTimes(1);
  expect(loadTripPlan(storage, "session")?.title).toBe("新しい旅");
  expect(content.textContent).toContain("新しい旅");
});

it("blocks every legacy writer and legacy single-key migration while server source is unavailable", () => {
  const workspace = createTripWorkspaceController("session");
  workspace.attach("session", { sourceState: "server-v2", getLoadState: () => "unavailable", getCurrentTrip: () => undefined });
  const storage = { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn(), key: () => null, length: 0 } satisfies Storage;
  const panel = document.createElement("section"), toggle = document.createElement("button");
  const legacy = configureTripPlanPanel(panel, document.createElement("div"), document.createElement("button"), toggle,
    "session", vi.fn(), storage, undefined, () => !workspace.blocksLegacy());
  legacy.switchSession("session");
  legacy.show({ version: 1, id: "old", title: "old", destination: "x", items: [], updatedAt: "2026-09-13" });
  legacy.apply([{ type: "metadata", title: "wrong" }]);
  legacy.selectAccommodation({ name: "wrong", checkInDate: "2026-09-14", checkOutDate: "2026-09-15" });
  legacy.open();
  expect(panel.hidden).toBe(true); expect(toggle.hidden).toBe(true);
  expect(storage.getItem).not.toHaveBeenCalled(); expect(storage.setItem).not.toHaveBeenCalled(); expect(storage.removeItem).not.toHaveBeenCalled();
});
