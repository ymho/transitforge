// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTripProposal, createTrip } from "@raiquora/trip/trip";
import { multiCityTrip, placeActivity, placesAt, placesTripId } from "../../../../modules/trip/domain/trip-places.fixture";
import { tripWorkspacePreviewSource } from "../../dev/trip-workspace-preview";
import { createTripWorkspaceController, type TripWorkspaceSource } from "../../usecases/trip-plan/trip-workspace-controller";
import { configureTripWorkspace } from "./trip-workspace";
import { createServerTripWorkspaceSource } from "../../usecases/trip-plan/server-trip-workspace-source";
import { costForecast } from "../../../../modules/trip/domain/trip-costs.fixture";

function setup(source?: TripWorkspaceSource) {
  const app = document.createElement("main"); app.id = "app"; document.body.append(app);
  const chat = document.createElement("section"); chat.id = "chat";
  const messages = document.createElement("ol"), input = document.createElement("input"); chat.append(messages, input);
  app.append(chat);
  const controller = createTripWorkspaceController("one"), ask = vi.fn(), showContext = vi.fn(), returnToConversation = vi.fn();
  if (source) controller.attach("one", source);
  const ui = configureTripWorkspace({ app, chat, messages, input, controller, ask, showContext, returnToConversation, showMap: vi.fn(), nextItemId: () => "new-free" });
  return { app, chat, messages, input, controller, ui, ask, showContext };
}
function button(root: ParentNode, text: string) { return [...root.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text)!; }
afterEach(() => document.body.replaceChildren());

describe("Trip workspace DOM and mobile navigation", () => {
  it("switches the four detail tabs with keyboard semantics while keeping one Trip source", () => {
    const f = setup({ getCurrentTrip: multiCityTrip });
    const tabs = [...f.ui.panel.querySelectorAll<HTMLButtonElement>('.trip-detail-tabs > [role="tab"]')];
    expect(tabs.map((tab) => tab.textContent)).toEqual(["概要", "旅程", "費用", "地図"]);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    tabs[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(tabs[1]?.getAttribute("aria-selected")).toBe("true");
    expect(f.ui.panel.querySelector<HTMLElement>("#trip-detail-overview")?.hidden).toBe(true);
    tabs[3]?.click(); expect(f.ui.panel.querySelector<HTMLElement>("#trip-detail-map")?.hidden).toBe(false);
    expect(f.ui.panel.textContent).toContain("経路形状を確認できない区間は、直線で補完しません");
    expect(f.controller.current()).toEqual(multiCityTrip());
  });
  it("derives day tabs from authored schedules and keeps unscheduled items separate", () => {
    const f = setup({ getCurrentTrip: multiCityTrip });
    button(f.ui.panel, "旅程").click();
    const dayTabs = [...f.ui.panel.querySelectorAll<HTMLButtonElement>(".trip-day-tabs [role=tab]")];
    expect(dayTabs.map((tab) => tab.textContent)).toEqual(["2026-09-22", "日時未定"]);
    expect(f.ui.panel.querySelector<HTMLElement>('[data-item-id="hotel"]')?.closest<HTMLElement>(".trip-workspace-day")?.hidden).toBe(false);
    dayTabs[1]!.click();
    expect(f.ui.panel.querySelector<HTMLElement>('[data-item-id="hotel"]')?.closest<HTMLElement>(".trip-workspace-day")?.hidden).toBe(true);
    expect(f.ui.panel.querySelector<HTMLElement>('[data-item-id="activity"]')?.closest<HTMLElement>(".trip-workspace-day")?.hidden).toBe(false);
  });
  it("does not discard an unsubmitted cost edit while switching detail tabs", () => {
    const base = multiCityTrip();
    const trip = applyTripProposal(base, { tripId: base.id, baseRevision: base.revision, summary: "概算", patches: [
      { type: "cost_forecast", forecast: costForecast(base.id, base.revision) },
    ] });
    const f = setup({ getCurrentTrip: () => trip, confirmProposal: async () => undefined });
    button(f.ui.panel, "費用").click(); button(f.ui.panel, "交通の金額を編集").click();
    const input = f.ui.panel.querySelector<HTMLInputElement>(".trip-cost-editor input")!; input.value = "12345";
    button(f.ui.panel, "概要").click(); expect(input.isConnected).toBe(true);
    button(f.ui.panel, "費用").click(); expect(f.ui.panel.querySelector<HTMLInputElement>(".trip-cost-editor input")?.value).toBe("12345");
  });
  it("keeps server ownership while loading/unavailable, retries and only previews changes", async () => {
    const trip = multiCityTrip(), get = vi.fn(async () => trip);
    const source = createServerTripWorkspaceSource(trip.id, { get });
    const f = setup(source);
    expect(f.ui.panel.hidden).toBe(false);
    expect(f.ui.panel.textContent).toContain("読み込んでいます");
    await source.refresh();
    expect(f.ui.panel.textContent).toContain(trip.title);
    expect(f.ui.panel.querySelector(".trip-workspace-notice")?.textContent).toContain("まだ保存できません");
    f.controller.propose("削除案", [{ type: "remove", itemId: "activity" }]);
    expect(f.controller.current()).toEqual(trip); expect(f.controller.canConfirm()).toBe(false);
    expect(f.ui.panel.textContent).toContain("保存機能はまだ有効ではありません");
    get.mockRejectedValueOnce(new Error("offline")); await source.refresh();
    expect(f.controller.current()).toBeUndefined(); expect(f.controller.blocksLegacy()).toBe(true);
    expect(f.ui.panel.textContent).toContain("旧旅程へは切り替えていません");
    button(f.ui.panel, "旅程を再読み込み").click();
    await vi.waitFor(() => expect(f.ui.panel.textContent).toContain(trip.title));
    expect(f.controller.current()).toEqual(trip);
  });
  it("keeps the workspace hidden when no Trip source exists; empty Trip is supported", () => {
    const f = setup(); expect(f.ui.panel.hidden).toBe(true); expect(f.app.dataset.tripWorkspace).toBeUndefined();
    f.controller.attach("one", { getCurrentTrip: () => createTrip(placesTripId, "空の旅程", placesAt) });
    expect(f.ui.panel.hidden).toBe(false); expect(f.ui.panel.textContent).toContain("空の旅程");
    expect(f.ui.panel.querySelectorAll(".trip-workspace-card")).toHaveLength(0);
  });
  it("preserves input, session, both scroll positions, focus, collapse and proposal through chat/trip/chat", () => {
    const f = setup({ getCurrentTrip: multiCityTrip }); f.input.value = "編集中の文章"; f.messages.scrollTop = 240; f.input.focus();
    f.controller.focus("activity"); f.controller.propose("順序変更", [{ type: "move", itemId: "activity" }]);
    button(f.ui.nav, "旅程").click(); f.ui.panel.scrollTop = 330;
    const card = f.ui.panel.querySelector<HTMLElement>('[data-item-id="activity"]')!;
    button(card, "閉じる").click(); expect(button(card, "開く").getAttribute("aria-expanded")).toBe("false");
    button(f.ui.nav, "会話").click();
    expect(f.input.value).toBe("編集中の文章"); expect(document.activeElement).toBe(f.input); expect(f.messages.scrollTop).toBe(240);
    expect(f.controller.sessionId()).toBe("one"); expect(f.controller.uiFocus()?.itemId).toBe("activity"); expect(f.controller.proposal()?.summary).toBe("順序変更");
    button(f.ui.nav, "旅程").click(); expect(f.ui.panel.scrollTop).toBe(330); expect(button(card, "開く")).toBeDefined();
    expect(button(f.ui.nav, "旅程").getAttribute("aria-pressed")).toBe("true");
    expect(f.app.contains(f.chat)).toBe(true); expect(f.ui.panel.querySelectorAll(".trip-workspace-diff")).toHaveLength(1);
  });
  it("direct edits only preview, then update one card at explicit in-memory confirmation", async () => {
    let trip = multiCityTrip(); const f = setup({ getCurrentTrip: () => trip, confirmProposal: async (p) => { trip = applyTripProposal(trip, p); } });
    const oldHotel = f.ui.panel.querySelector('[data-item-id="hotel"]');
    const activity = f.ui.panel.querySelector<HTMLElement>('[data-item-id="activity"]')!;
    button(activity, "名称を変更").click(); const editor = activity.querySelector<HTMLFormElement>("form")!, input = editor.querySelector("input")!;
    expect(document.activeElement).toBe(input); input.value = "ゆっくり散策"; editor.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(trip.items[2]?.title).toBe("Zürich"); expect(f.ui.panel.textContent).toContain("変更後");
    button(f.ui.panel, "確認して、この画面内に反映").click(); await vi.waitFor(() => expect(trip.items[2]?.title).toBe("ゆっくり散策"));
    expect(f.ui.panel.querySelector('[data-item-id="hotel"]')).toBe(oldHotel);
    expect(oldHotel?.querySelector('option[value="activity"]')?.textContent).toContain("ゆっくり散策");
    await vi.waitFor(() => expect(f.ui.panel.querySelector('[role="status"]')?.textContent).toContain("永続保存はしていません"));
  });
  it("add/remove/move use the shared proposal path and consultation sends intent with focus", () => {
    const trip = multiCityTrip(), f = setup({ getCurrentTrip: () => trip });
    const form = f.ui.panel.querySelector<HTMLFormElement>(".trip-workspace-add")!; form.querySelector("input")!.value = "休憩";
    form.dispatchEvent(new Event("submit", { cancelable: true })); expect(f.controller.proposal()?.patches[0]).toMatchObject({ type: "add", item: { id: "new-free" } });
    const activity = f.ui.panel.querySelector<HTMLElement>('[data-item-id="activity"]')!;
    button(activity, "削除案").click(); expect(f.controller.proposal()?.patches).toEqual([{ type: "remove", itemId: "activity" }]);
    activity.querySelector<HTMLSelectElement>("select")!.value = ""; button(activity, "移動案").click();
    expect(f.controller.proposal()?.patches).toEqual([{ type: "move", itemId: "activity" }]);
    button(activity, "相談する").click(); expect(f.ask).toHaveBeenCalledWith("この予定を相談したい"); expect(f.controller.uiFocus()).toEqual({ itemId: "activity" });
    expect(f.app.dataset.tripWorkspaceView).toBe("chat"); expect(trip.items).toHaveLength(3);
  });
  it("keeps candidate assessment outside adopted cards; unknown is not fine weather or zero price", () => {
    const f = setup(tripWorkspacePreviewSource()); const before = structuredClone(f.controller.current());
    const candidates = f.ui.panel.querySelector(".trip-workspace-candidates")!;
    expect(candidates.textContent).toContain("未採用"); expect(candidates.textContent).toContain("0円ではありません"); expect(candidates.textContent).toContain("旅行全体の評価ではありません");
    expect(candidates.closest(".trip-workspace-card")).toBeNull(); expect(f.ui.panel.textContent).toContain("EUR 120.00");
    expect(f.ui.panel.textContent).toContain("今回の人数"); expect(f.controller.current()).toEqual(before);
  });
  it("session change drops neither proposals nor selection; another Trip does not receive them", () => {
    const f = setup({ getCurrentTrip: multiCityTrip }); f.controller.focus("activity"); f.controller.propose("削除", [{ type: "remove", itemId: "activity" }]);
    f.controller.attach("two", { getCurrentTrip: () => createTrip("22222222-2222-4222-8222-222222222222", "別の旅", placesAt, [placeActivity("other")]) });
    f.controller.activateSession("two"); expect(f.ui.panel.textContent).not.toContain("変更案（まだ反映"); expect(f.controller.uiFocus()).toBeUndefined();
    f.controller.activateSession("one"); expect(f.ui.panel.textContent).toContain("変更案（まだ反映"); expect(f.controller.uiFocus()?.itemId).toBe("activity");
  });
  it("restores the selected detail and day tabs when returning to a conversation", () => {
    const f = setup({ getCurrentTrip: multiCityTrip });
    button(f.ui.panel, "旅程").click();
    [...f.ui.panel.querySelectorAll<HTMLButtonElement>(".trip-day-tabs [role=tab]")].find((tab) => tab.textContent === "日時未定")!.click();
    const other = createTrip("22222222-2222-4222-8222-222222222222", "別の旅", placesAt, [placeActivity("other")]);
    f.controller.attach("two", { getCurrentTrip: () => other }); f.controller.activateSession("two");
    expect(button(f.ui.panel, "概要").getAttribute("aria-selected")).toBe("true");
    button(f.ui.panel, "費用").click();
    f.controller.activateSession("one");
    expect(button(f.ui.panel, "旅程").getAttribute("aria-selected")).toBe("true");
    expect([...f.ui.panel.querySelectorAll<HTMLButtonElement>(".trip-day-tabs [role=tab]")].find((tab) => tab.textContent === "日時未定")?.getAttribute("aria-selected")).toBe("true");
    f.controller.activateSession("two"); expect(button(f.ui.panel, "費用").getAttribute("aria-selected")).toBe("true");
  });
});
