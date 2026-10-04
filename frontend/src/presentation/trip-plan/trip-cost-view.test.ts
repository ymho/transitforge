// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { createTrip, applyTripProposal, type Trip, type ItineraryItem } from "@raiquora/trip/trip";
import { itemCost } from "@raiquora/trip/item-cost";
import { createTripWorkspaceController } from "../../usecases/trip-plan/trip-workspace-controller";
import { createServerTripWorkspaceSource } from "../../usecases/trip-plan/server-trip-workspace-source";
import { configureTripWorkspace } from "./trip-workspace";
import { itemCostCopy } from "./trip-cost-view";
const button = (root: ParentNode, text: string) => [...root.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === text)!;
const food: Extract<ItineraryItem, { type: "activity" }> = { id: "food", title: "昼食", type: "activity", category: "food", schedule: { type: "unscheduled" } };
afterEach(() => document.body.replaceChildren());
async function setup() {
  let server: Trip = createTrip("11111111-1111-4111-8111-111111111111", "旅行", "2026-09-01T00:00:00Z", [food,
    { ...food, id: "visit", title: "観光", category: "sightseeing" },
    { id: "rail", title: "列車", type: "transport", detail: { status: "unresolved", mode: "rail" }, schedule: { type: "unscheduled" } }]);
  const mutate = vi.fn(async (input) => { server = { ...applyTripProposal(server, input.proposal), revision: server.revision + 1 }; return server; });
  const source = createServerTripWorkspaceSource(server.id, { get: async () => server }, { mutate, newMutationId: () => crypto.randomUUID(), validateConfirmation: async () => {} });
  const controller = createTripWorkspaceController("a"); controller.attach("a", source); await source.refresh();
  const app = document.createElement("main"), chat = document.createElement("section"), messages = document.createElement("ol"), input = document.createElement("input");
  document.body.append(app); app.append(chat); chat.append(messages, input);
  const ask = vi.fn(), ui = configureTripWorkspace({ app, chat, messages, input, controller, ask, showContext: vi.fn(), returnToConversation: vi.fn(), showMap: vi.fn(), nextItemId: () => "item" });
  return { ui, controller, source, mutate, ask, server: () => server, replace: (value: Trip) => { server = value; } };
}
it("reviews, saves and rereads item estimates without an AI forecast, leaving rail and other items untouched", async () => {
  const f = await setup(), panel = f.ui.panel;
  expect(panel.querySelectorAll(".trip-item-cost")).toHaveLength(2);
  expect(panel.querySelector('[data-item-id="rail"] .trip-item-cost')).toBeNull();
  expect(panel.textContent).not.toContain("AIに概算"); expect(panel.querySelector(".trip-extra-details")).toBeNull();
  const row = () => panel.querySelector('[data-item-id="food"]')!;
  button(row(), "金額を入力").click();
  const form = row().querySelector<HTMLFormElement>(".trip-cost-editor")!;
  form.querySelector("input")!.value = "-100"; form.dispatchEvent(new Event("submit", { cancelable: true }));
  expect(f.controller.proposal()).toBeUndefined(); expect(f.mutate).not.toHaveBeenCalled();
  form.querySelector("input")!.value = "0"; form.dispatchEvent(new Event("submit", { cancelable: true }));
  expect(f.server().costs).toBeUndefined(); button(panel, "確認して旅程を保存").click();
  await vi.waitFor(() => expect(itemCost(f.server(), food)?.amount.amountMinor).toBe(0));
  await f.source.refresh(); expect(row().textContent).toContain("JPY 0");
  expect(f.server().costs?.forecast).toBeUndefined(); expect(f.ask).not.toHaveBeenCalled();
  button(row(), "JPY 0").click(); button(row(), "入力を削除").click(); button(panel, "確認して旅程を保存").click();
  await vi.waitFor(() => expect(itemCost(f.server(), food)).toBeUndefined()); f.ui.destroy();
});
it("preserves an interrupted form but rejects outdated revisions and conversations", async () => {
  const f = await setup(), panel = f.ui.panel;
  button(panel.querySelector('[data-item-id="food"]')!, "金額を入力").click();
  const form = panel.querySelector<HTMLFormElement>(".trip-cost-editor")!; form.querySelector("input")!.value = "12345";
  f.replace({ ...f.server(), revision: 1 }); await f.source.refresh();
  expect(panel.contains(form)).toBe(true); expect(form.querySelector("input")!.value).toBe("12345");
  form.dispatchEvent(new Event("submit", { cancelable: true })); expect(f.controller.proposal()).toBeUndefined();
  f.controller.activateSession("b"); expect(panel.contains(form)).toBe(false); form.dispatchEvent(new Event("submit", { cancelable: true })); expect(f.mutate).not.toHaveBeenCalled(); f.ui.destroy();
});
it("displays the hotel's observed minimum with its unit and never multiplies it by the party", () => {
  const stay: ItineraryItem = { id: "hotel", type: "stay", title: "宿", schedule: { type: "unscheduled" }, selection: { status: "selected", accommodation: {
    provider: "rakuten-travel", providerItemId: "42", place: { name: "宿", sources: [] }, selectedAt: "2026-10-04T00:00:00Z", checkInDate: "2026-10-05", checkOutDate: "2026-10-06", sources: [],
    observedPrice: { price: { currency: "JPY", amountMinor: 9000 }, observedAt: "2026-10-04T00:00:00Z", basis: "reference-minimum" },
  } } };
  const trip = createTrip("11111111-1111-4111-8111-111111111111", "旅", "2026-10-04T00:00:00Z");
  expect(itemCostCopy(trip, stay)).toBe("JPY 9,000〜 / 1室1泊");
});
