// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { createTripWorkspaceController } from "../../usecases/trip-plan/trip-workspace-controller";
import { orderTrip } from "../../usecases/trip-plan/propose-trip-order.fixture";
import { createTrip, applyTripProposal } from "@raiquora/trip/trip";
import { placeTransport, placesAt, placesTripId } from "../../../../modules/trip/domain/trip-places.fixture";
import { openTripOrderEditor } from "./trip-order-editor";
afterEach(() => document.body.replaceChildren());
function setup(trip = orderTrip()) {
  const controller = createTripWorkspaceController("one"), report = vi.fn();
  controller.attach("one", { getCurrentTrip: () => trip, confirmProposal: async p => { trip = applyTripProposal(trip, p); } }); openTripOrderEditor(controller, report);
  return { controller, trip, current: () => trip, report, dialog: document.querySelector("dialog")! };
}
it("warns about clearing times and saves cross-day changes directly", async () => {
  const { controller, dialog, current } = setup();
  expect(dialog.textContent).toContain("時刻は未設定");
  const select = dialog.querySelector<HTMLSelectElement>('[data-item-id="a"] select')!;
  select.value = [...select.options].find(o => o.textContent === "2026-09-23")!.value; select.dispatchEvent(new Event("change"));
  [...dialog.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "確定")!.click();
  await vi.waitFor(() => expect(dialog.isConnected).toBe(false));
  const after = current(); expect(controller.proposal()).toBeUndefined();
  expect(after.items.find(i => i.id === "a")!.schedule).toMatchObject({ type: "day", date: "2026-09-23" });
});
it("cancel retains times and transport has no move controls", () => {
  const trip = createTrip(placesTripId, "予定", placesAt, [placeTransport("rail", "A", "B"), ...orderTrip().items]);
  const { controller, dialog } = setup(trip);
  const row = dialog.querySelector<HTMLElement>('[data-item-id="rail"]')!;
  expect(row.draggable).toBe(false); expect(row.querySelector("button,select")).toBeNull(); expect(row.textContent).toContain("固定");
  dialog.querySelector<HTMLButtonElement>('[aria-label="自由時間を下へ"]')!.click();
  [...dialog.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "取消")!.click();
  expect(controller.proposal()).toBeUndefined(); expect(trip.items[1]!.schedule.type).toBe("fixed");
});
it("rejects changes when revision or session is stale", () => {
  let trip = orderTrip(); const controller = createTripWorkspaceController("one"), report = vi.fn();
  controller.attach("one", { getCurrentTrip: () => trip }); openTripOrderEditor(controller, report);
  const dialog = document.querySelector("dialog")!;
  dialog.querySelector<HTMLButtonElement>('[data-item-id="a"] button:last-child')!.click();
  trip = { ...trip, revision: trip.revision + 1 };
  [...dialog.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "確定")!.click();
  expect(controller.proposal()).toBeUndefined(); expect(report).toHaveBeenCalledWith(expect.stringContaining("更新"));
});
