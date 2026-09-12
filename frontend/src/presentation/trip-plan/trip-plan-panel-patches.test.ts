// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import type { TripPlan } from "@raiquora/trip/trip-plan";
import { configureTripPlanPanel } from "./trip-plan-panel";
import { loadTripPlan } from "../../usecases/trip-plan/trip-plan-repository";

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
