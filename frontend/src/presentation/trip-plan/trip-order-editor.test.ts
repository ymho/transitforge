// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { multiCityTrip } from "../../../../modules/trip/domain/trip-places.fixture";
import { createTripWorkspaceController } from "../../usecases/trip-plan/trip-workspace-controller";
import { applyTripProposal } from "@raiquora/trip/trip";
import { openTripOrderEditor } from "./trip-order-editor";
import { renderWorkspaceProposal } from "./trip-workspace-proposal";
import { renderTripWarnings } from "./trip-warning-view";
afterEach(() => document.body.replaceChildren());

it("previews reordered IDs without editing schedules, and cancel leaves the Trip unchanged", () => {
  const trip = multiCityTrip(), original = structuredClone(trip), controller = createTripWorkspaceController("one");
  controller.attach("one", { getCurrentTrip: () => trip });
  openTripOrderEditor(controller, vi.fn());
  const dialog = document.querySelector("dialog")!;
  const preview = [...dialog.querySelectorAll("button")].find(button => button.textContent === "変更を確認")!;
  expect(preview.disabled).toBe(true);
  dialog.querySelectorAll<HTMLButtonElement>(".trip-order-row button")[1]!.click();
  expect(preview.disabled).toBe(false); preview.click();
  const proposal = controller.proposal()!, after = applyTripProposal(trip, proposal);
  expect(after.items.map(item => item.id)).toEqual([trip.items[1]!.id, trip.items[0]!.id, trip.items[2]!.id]);
  for (const item of after.items) expect(item).toEqual(trip.items.find(before => before.id === item.id));
  expect(trip).toEqual(original);
  const confirmation = renderWorkspaceProposal(trip, proposal, controller, vi.fn());
  expect(confirmation.querySelectorAll(".trip-workspace-diff")).toHaveLength(0);
  expect(confirmation.querySelectorAll(".trip-order-preview li")).toHaveLength(3);
  expect(confirmation.textContent).not.toContain("行程順"); expect(confirmation.textContent).not.toContain("サーバ");
  controller.dismiss(); openTripOrderEditor(controller, vi.fn());
  [...document.querySelectorAll<HTMLButtonElement>("dialog button")].find(button => button.textContent === "取消")!.click();
  expect(controller.proposal()).toBeUndefined(); expect(trip).toEqual(original);
});

it("rejects an editor after the Trip revision or session changes", () => {
  let trip = multiCityTrip(); const controller = createTripWorkspaceController("one"), report = vi.fn();
  controller.attach("one", { getCurrentTrip: () => trip }); openTripOrderEditor(controller, report);
  const dialog = document.querySelector("dialog")!;
  dialog.querySelectorAll<HTMLButtonElement>(".trip-order-row button")[1]!.click();
  trip = { ...trip, revision: trip.revision + 1 };
  [...dialog.querySelectorAll("button")].find(button => button.textContent === "変更を確認")!.click();
  expect(controller.proposal()).toBeUndefined(); expect(report).toHaveBeenCalledWith(expect.stringContaining("更新"));
});

it("groups and deduplicates warnings with a visible summary", () => {
  const warning = renderTripWarnings(["時刻を確認してください", "時刻を確認してください", "営業日を確認してください"])!;
  expect(warning.querySelectorAll("li")).toHaveLength(2);
  expect(warning.querySelector("summary")?.textContent).toBe("⚠確認");
  expect(renderTripWarnings([])).toBeUndefined();
});
