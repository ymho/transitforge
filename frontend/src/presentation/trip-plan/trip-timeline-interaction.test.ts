// @vitest-environment happy-dom
import { expect, it, afterEach, vi } from "vitest";
import { createTripWorkspaceController } from "../../usecases/trip-plan/trip-workspace-controller";
import { createTrip, applyTripProposal } from "@raiquora/trip/trip";
import { multiCityTrip } from "../../../../modules/trip/domain/trip-places.fixture";
import { configureTripWorkspace } from "./trip-workspace";
import { renderTripTimeEditor } from "./trip-time-editor";
import { renderTripRouteTimeline } from "./trip-route-timeline";
import { railSelectionFixture } from "../../../../modules/trip/domain/selected-rail-journey.fixture";
import { selectRailJourney, projectRailSchedule } from "@raiquora/trip/selected-rail-journey";
const button = (root: ParentNode, text: string) => [...root.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === text)!;
afterEach(() => document.body.replaceChildren());
it("adds directly after the chosen spot with its day and fences a stale editor after switching trips", () => {
  const trip = multiCityTrip(), controller = createTripWorkspaceController("one"); controller.attach("one", { getCurrentTrip: () => trip });
  const app = document.createElement("main"), chat = document.createElement("section"); document.body.append(app);
  const ui = configureTripWorkspace({ app, chat, messages: document.createElement("div"), input: document.createElement("input"), controller, ask: vi.fn(), showContext: vi.fn(), returnToConversation: vi.fn(), showMap: vi.fn(), nextItemId: () => "after", showTripList: vi.fn() });
  const card = app.querySelector<HTMLElement>('[data-item-id="hotel"]')!;
  button(card, "＋ この後に追加").click(); const form = app.querySelector<HTMLFormElement>(".trip-workspace-add")!;
  expect(form.hidden).toBe(false); expect(card.nextElementSibling).toBe(form);
  form.querySelector("input")!.value = "夕食"; form.dispatchEvent(new Event("submit", { cancelable: true }));
  expect(controller.proposal()?.patches[0]).toMatchObject({ type: "add", afterId: "hotel", item: { schedule: { type: "day", date: "2026-09-22" } } });
  controller.attach("two", { getCurrentTrip: () => createTrip("22222222-2222-4222-8222-222222222222", "別の旅", trip.createdAt) }); controller.activateSession("two");
  form.dispatchEvent(new Event("submit", { cancelable: true })); expect(controller.proposal()).toBeUndefined(); expect(ui.panel.textContent).toContain("最新の旅程");
});
it("previews and confirms a manually entered time; a detached editor cannot write into another trip", async () => {
  let trip = multiCityTrip(); const controller = createTripWorkspaceController("one"), report = vi.fn();
  controller.attach("one", { getCurrentTrip: () => trip, confirmProposal: async p => { trip = applyTripProposal(trip, p); } });
  const item = trip.items[2]!, editor = renderTripTimeEditor(trip, item, undefined, controller, report); document.body.append(editor);
  button(editor, "未定").click(); const form = editor.querySelector("form")!, inputs = form.querySelectorAll("input");
  inputs[0]!.value = "2026-10-05"; inputs[1]!.value = "10:00"; inputs[4]!.value = "Asia/Tokyo";
  form.dispatchEvent(new Event("submit", { cancelable: true })); expect(trip.items[2]?.schedule.type).toBe("unscheduled");
  await controller.confirm(); expect(trip.items[2]?.schedule).toMatchObject({ type: "fixed", startAt: { at: "2026-10-05T10:00:00+09:00" } });
  controller.attach("two", { getCurrentTrip: () => createTrip("22222222-2222-4222-8222-222222222222", "別の旅", trip.createdAt) }); controller.activateSession("two");
  form.dispatchEvent(new Event("submit", { cancelable: true })); expect(controller.proposal()).toBeUndefined(); expect(report).toHaveBeenLastCalledWith(expect.stringContaining("最新の予定"));
});
it("renders every rail leg and the actual transfer interval without presenting minimum transfer as walking time", () => {
  const f = railSelectionFixture(), journey = selectRailJourney(f.candidate, f.inputs, f.selectedAt);
  const item = { id: "route", title: "経路", type: "transport" as const, schedule: projectRailSchedule(journey), detail: { status: "selected" as const, mode: "rail" as const, journey } };
  const route = renderTripRouteTimeline(item); expect(route.querySelectorAll(".trip-route-leg")).toHaveLength(2);
  expect(route.textContent).toContain("B・乗換10分"); expect(route.textContent).toContain("内訳未取得"); expect(route.textContent).not.toContain("徒歩5分");
});
