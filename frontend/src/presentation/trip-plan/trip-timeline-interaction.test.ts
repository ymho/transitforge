// @vitest-environment happy-dom
import { expect, it, afterEach, vi } from "vitest";
import { createTripWorkspaceController } from "../../usecases/trip-plan/trip-workspace-controller";
import { createTrip, applyTripProposal } from "@raiquora/trip/trip";
import { multiCityTrip, placeStay } from "../../../../modules/trip/domain/trip-places.fixture";
import { configureTripWorkspace } from "./trip-workspace";
import { renderTripTimeEditor } from "./trip-time-editor";
import { renderTripRouteTimeline } from "./trip-route-timeline";
import { railSelectionFixture } from "../../../../modules/trip/domain/selected-rail-journey.fixture";
import { selectRailJourney, projectRailSchedule } from "@raiquora/trip/selected-rail-journey";
const button = (root: ParentNode, text: string) => [...root.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === text)!;
afterEach(() => document.body.replaceChildren());
it("consults from a gap with its day, closes the editor and fences stale submission after switching trips", () => {
  const trip = multiCityTrip(), controller = createTripWorkspaceController("one"); controller.attach("one", { getCurrentTrip: () => trip });
  const app = document.createElement("main"), chat = document.createElement("section"); document.body.append(app);
  const ask = vi.fn();
  const ui = configureTripWorkspace({ app, chat, messages: document.createElement("div"), input: document.createElement("input"), controller, ask, showContext: vi.fn(), returnToConversation: vi.fn(), showMap: vi.fn(), nextItemId: () => "after", showTripList: vi.fn() });
  const card = app.querySelector<HTMLElement>('[data-item-id="hotel"]')!;
  const gap = card.nextElementSibling as HTMLButtonElement; expect(gap.classList.contains("trip-timeline-add")).toBe(true); gap.click();
  const form = app.querySelector<HTMLFormElement>(".trip-workspace-add")!;
  form.querySelector("textarea")!.value = "夕食を食べたい";
  expect(form.closest("dialog")?.open).toBe(true); form.dispatchEvent(new Event("submit", { cancelable: true }));
  expect(ask).toHaveBeenLastCalledWith(expect.stringContaining(`2026-09-22の「${trip.items.find(i => i.id === "hotel")!.title}」のチェックインの後`));
  expect(controller.uiFocus()).toEqual({ itemId: "hotel" }); expect(form.closest("dialog")?.open).toBe(false);
  expect(controller.proposal()).toBeUndefined(); gap.click();
  controller.attach("two", { getCurrentTrip: () => createTrip("22222222-2222-4222-8222-222222222222", "別の旅", trip.createdAt) }); controller.activateSession("two");
  form.dispatchEvent(new Event("submit", { cancelable: true })); expect(controller.proposal()).toBeUndefined(); expect(ui.panel.textContent).toContain("最新の旅程");
  expect(ask).toHaveBeenCalledTimes(1);
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
  const link = route.querySelector<HTMLAnchorElement>(".trip-route-booking")!;
  expect(link.textContent).toBe(""); expect(link.target).toBe("_blank");
  expect(link.getAttribute("aria-label")).toBe("e5489で予約（新しいタブで開く）");
  const logo = link.querySelector("img")!;
  expect(logo.src).toBe("https://www.jr-odekake.net/assets/img/logo_e5489.svg");
  expect(logo.alt).toBe("e5489"); expect(logo.referrerPolicy).toBe("no-referrer");
  expect(link.rel).toBe("noopener noreferrer"); expect(link.referrerPolicy).toBe("no-referrer");
  const params = new URL(link.href).searchParams;
  expect(params.get("inputDepartStName")).toBe("A"); expect(params.get("inputArriveStName")).toBe("C");
  expect(params.get("inputHour")).toBe("09"); expect(params.get("inputMinute")).toBe("00");
});
it("projects a rail trip into the actual workspace without losing its legs", () => {
  const f = railSelectionFixture(), journey = selectRailJourney(f.candidate, f.inputs, f.selectedAt);
  const trip = createTrip("11111111-1111-4111-8111-111111111111", "乗換のある旅", f.selectedAt, [{ id: "rail", title: "AからCへ", type: "transport", detail: { status: "selected", mode: "rail", journey }, schedule: projectRailSchedule(journey) }, { id: "visit", title: "町を歩く", type: "activity", category: "sightseeing", schedule: { type: "day", date: "2026-09-13", timeZone: "Asia/Tokyo" } }]);
  const controller = createTripWorkspaceController("one"); controller.attach("one", { getCurrentTrip: () => trip });
  const app = document.createElement("main"); document.body.append(app);
  configureTripWorkspace({ app, chat: document.createElement("section"), messages: document.createElement("div"), input: document.createElement("input"), controller, ask: vi.fn(), showContext: vi.fn(), returnToConversation: vi.fn(), showMap: vi.fn(), nextItemId: () => "after" });
  expect(app.querySelectorAll(".trip-route-leg")).toHaveLength(2);
});
it("shares one date tab for rail and an unknown-zone stay, retaining the correct add and time-edit targets after reload", async () => {
  const f = railSelectionFixture(), journey = selectRailJourney(f.candidate, f.inputs, f.selectedAt), originalStay = placeStay("hotel", "宿");
  if (originalStay.selection.status !== "selected") throw new Error("Selected fixture required");
  let trip = createTrip("11111111-1111-4111-8111-111111111111", "乗換と宿泊の旅", f.selectedAt, [
    { id: "rail", title: "AからCへ", type: "transport", detail: { status: "selected", mode: "rail", journey }, schedule: projectRailSchedule(journey) },
    { ...originalStay, schedule: { type: "day", date: "2026-09-13", endDate: "2026-09-14" }, selection: { status: "selected", accommodation: {
      ...originalStay.selection.accommodation, checkInDate: "2026-09-13", checkOutDate: "2026-09-14" } } },
  ]);
  const originalRail = structuredClone(trip.items[0]);
  const controller = createTripWorkspaceController("one");
  const source = { getCurrentTrip: () => trip, confirmProposal: async (p: Parameters<typeof applyTripProposal>[1]) => { trip = applyTripProposal(trip, p); } };
  controller.attach("one", source);
  const app = document.createElement("main"); document.body.append(app);
  let nextItem = 0; const ask = vi.fn();
  const ui = configureTripWorkspace({ app, chat: document.createElement("section"), messages: document.createElement("div"), input: document.createElement("input"), controller,
    ask, showContext: vi.fn(), returnToConversation: vi.fn(), showMap: vi.fn(), nextItemId: () => `after-${++nextItem}` });
  const tabs = () => [...app.querySelectorAll<HTMLButtonElement>('.trip-day-tabs [role="tab"]')];
  expect(tabs().map(t => t.textContent)).toEqual(["9月13日(日)", "9月14日(月)"]);
  const first = app.querySelector<HTMLElement>('.trip-workspace-day:not([hidden])')!;
  expect([...first.querySelectorAll<HTMLElement>('[data-item-id]')].map(c => c.dataset.itemId)).toEqual(["rail", "hotel"]);
  expect(first.querySelectorAll(".trip-route-leg")).toHaveLength(2);
  const checkIn = first.querySelector<HTMLElement>('[data-item-id="hotel"]')!;
  expect(checkIn.textContent).toContain("チェックイン");
  const time = checkIn.querySelector<HTMLButtonElement>('.trip-time-control button')!;
  expect(time.textContent).toBe("未定"); time.click();
  const timeForm = checkIn.querySelector<HTMLFormElement>('.trip-time-editor')!;
  expect(timeForm.querySelector<HTMLInputElement>('input[type="date"]')?.value).toBe("2026-09-13");
  expect(timeForm.querySelector<HTMLInputElement>('input[type="text"]')?.value).toBe("Asia/Tokyo");
  button(timeForm, "取消").click();
  (checkIn.nextElementSibling as HTMLButtonElement).click();
  const add = app.querySelector<HTMLFormElement>(".trip-workspace-add")!;
  add.querySelector("textarea")!.value = "夕食"; add.dispatchEvent(new Event("submit", { cancelable: true }));
  expect(ask).toHaveBeenLastCalledWith(expect.stringContaining("2026-09-13の「宿泊」のチェックインの後"));
  expect(controller.proposal()).toBeUndefined(); expect(trip.items[0]).toEqual(originalRail);
  trip = JSON.parse(JSON.stringify(trip)); controller.attach("one", source); ui.render();
  expect(tabs().map(t => t.textContent)).toEqual(["9月13日(日)", "9月14日(月)"]);
  expect(app.querySelectorAll('.trip-workspace-day:not([hidden]) [data-item-id]')).toHaveLength(2);
  tabs()[1]!.click();
  const checkout = app.querySelector<HTMLElement>('.trip-workspace-day:not([hidden]) [data-item-id="hotel"]')!;
  expect(checkout.textContent).toContain("チェックアウト");
  (checkout.nextElementSibling as HTMLButtonElement).click();
  add.querySelector("textarea")!.value = "朝食"; add.dispatchEvent(new Event("submit", { cancelable: true }));
  expect(ask).toHaveBeenLastCalledWith(expect.stringContaining("2026-09-14の「宿泊」のチェックアウトの後"));
  expect(controller.proposal()).toBeUndefined();
});
