import { tripWeatherFixture } from "../../../../modules/trip/domain/trip-weather.fixture";
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTripProposal, createTrip } from "@raiquora/trip/trip";
import { multiCityTrip, placeActivity, placesAt, placesTripId } from "../../../../modules/trip/domain/trip-places.fixture";
import { tripWorkspacePreviewSource } from "../../dev/trip-workspace-preview";
import { createTripWorkspaceController, type TripWorkspaceSource } from "../../usecases/trip-plan/trip-workspace-controller";
import { configureTripWorkspace } from "./trip-workspace";
import { createServerTripWorkspaceSource } from "../../usecases/trip-plan/server-trip-workspace-source";
import { inTripFixture } from "../../../../modules/trip/domain/in-trip-context.fixture";
import type { InTripContextSnapshot } from "@raiquora/trip/in-trip-context";
import { parsePublicPlanPresentation } from "@raiquora/agent/public-plan-presentation";

function setup(source?: TripWorkspaceSource, loadInTripContext?: (tripId: string) => Promise<InTripContextSnapshot | undefined>,
  actions: Partial<Pick<Parameters<typeof configureTripWorkspace>[0], "refreshWeather" | "renameTitle" | "changeAdoption" | "changeItemDecision" | "branchTrip" | "conversationId" | "onPlanAdoption">> = {}) {
  const app = document.createElement("main"); app.id = "app"; document.body.append(app);
  const chat = document.createElement("section"); chat.id = "chat";
  const messages = document.createElement("ol"), input = document.createElement("input"); chat.append(messages, input);
  app.append(chat);
  const controller = createTripWorkspaceController("one"), ask = vi.fn(), showContext = vi.fn(), returnToConversation = vi.fn();
  if (source) controller.attach("one", source);
  const ui = configureTripWorkspace({ app, chat, messages, input, controller, ask, showContext, returnToConversation, showMap: vi.fn(), loadInTripContext, nextItemId: () => "new-free", ...actions });
  return { app, chat, messages, input, controller, ui, ask, showContext };
}
function button(root: ParentNode, text: string) { return [...root.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text)!; }
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe("Trip workspace DOM and mobile navigation", () => {
  it("starts whole-route reselection with a stable item focus and keeps the adopted itinerary unchanged", () => {
    const trip = multiCityTrip(), before = structuredClone(trip);
    const f = setup({ getCurrentTrip: () => trip });
    f.ui.showPlan();
    const card = f.ui.panel.querySelector<HTMLElement>('[data-item-id="movement"]')!;
    button(card, "経路全体を選び直す").click();
    expect(f.controller.uiFocus()).toEqual({ itemId: "movement" });
    expect(f.ask).toHaveBeenCalledWith(expect.stringContaining("経路全体を再検索"));
    expect(f.controller.current()).toEqual(before); expect(f.controller.proposal()).toBeUndefined();
  });
  it("shows only a pending notice and returns to chat for adoption", async () => {
    const trip = createTrip(placesTripId, "出雲旅行", placesAt), confirm = vi.fn(async () => undefined);
    const adopt = vi.fn(async () => ({ changes: { added: 1, replaced: 0, removed: 0 }, confirm }));
    const f = setup({ getCurrentTrip: () => trip }, undefined, { conversationId: () => "one", onPlanAdoption: adopt });
    const plan = parsePublicPlanPresentation({ version: "public-plan-presentation-v1", presentationId: "draft", target: { tripId: trip.id, baseTripRevision: trip.revision },
      candidateSetRef: { kind: "candidate-set-ref", candidateSetId: "draft", revision: 0, baseTripRevision: trip.revision }, candidateOrder: ["plan-1"],
      candidates: [{ variantId: "plan-1", label: "1泊の案", dayOrder: ["day-1"], days: [{ dayRef: "day-1", label: "1日目", status: "planned", entries: [{ entryRef: "entry", itemRef: "visit", role: "visit" }] }],
        items: [{ itemRef: "visit", sourceRef: "visit", title: "出雲大社を参拝", kind: "activity", timing: "day", evidenceRefs: [], photoRefs: [] }], unknowns: ["移動時刻"], cost: { status: "unknown" }, workload: { status: "unknown" }, comparisonAssessmentRefs: [], scenarioRefs: [] }],
      evidenceRefs: [], photoRefs: [], coverage: { status: "partial", coveredDayRefs: ["day-1"], omittedDayRefs: [], omittedScopes: ["移動時刻"] }, statements: [], comparisonAssessmentRefs: [], scenarioRefs: [],
      researchOutcome: { status: "partial", requestedMode: "standard", effectiveMode: "standard", budget: { modelCalls: 2, toolCalls: 1, wallClockMs: 10 }, coveredScopes: ["旅程"], remainingScopes: ["移動時刻"] } });
    f.controller.presentPlan(plan); f.ui.showPlan();
    expect(f.ui.panel.hidden).toBe(false);
    expect(f.ui.panel.querySelector<HTMLElement>("#trip-detail-itinerary")?.hidden).toBe(false);
    expect(f.ui.panel.textContent).toContain("未採用の提案があります");
    expect(f.ui.panel.textContent).not.toContain("出雲大社を参拝");
    expect(f.ui.panel.querySelector(".public-plan-presentation")).toBeNull();
    expect(trip.items).toEqual([]); expect(adopt).not.toHaveBeenCalled();
    button(f.ui.panel, "相談で確認").click();
    expect(f.app.dataset.tripWorkspaceView).toBe("chat");
    expect(confirm).not.toHaveBeenCalled();
    f.controller.activateSession("two"); expect(f.controller.plan()).toBeUndefined();
  });
  it("opens the timeline directly and retains useful controls in details", () => {
    const f = setup({ getCurrentTrip: multiCityTrip }); f.ui.showPlan();
    expect(f.ui.panel.querySelector(".trip-detail-tabs")).toBeNull();
    expect(f.ui.panel.querySelector("#trip-detail-map")).toBeNull();
    expect(f.ui.panel.querySelector(".trip-workspace-days")).not.toBeNull();
    const details = f.ui.panel.querySelector<HTMLDetailsElement>(".trip-extra-details")!;
    expect(f.ui.panel.querySelector(".trip-workspace-readiness")).toBeNull();
    expect(f.ui.panel.querySelector(".trip-workspace-checklist")).toBeNull();
    expect(f.ui.panel.querySelector(".trip-workspace-feasibility")).toBeNull();
    expect(details).toBeNull();
    expect(f.controller.current()).toEqual(multiCityTrip());
  });
  it("derives day tabs from authored schedules and keeps unscheduled items separate", () => {
    const f = setup({ getCurrentTrip: multiCityTrip });
    f.ui.showPlan();
    const dayTabs = [...f.ui.panel.querySelectorAll<HTMLButtonElement>(".trip-day-tabs [role=tab]")];
    expect(dayTabs.map((tab) => tab.textContent)).toEqual(["9月22日(火)", "9月23日(水)", "日時未定"]);
    expect(f.ui.panel.querySelectorAll<HTMLElement>('.trip-workspace-days [data-item-id="hotel"]').length).toBe(2);
    expect(f.ui.panel.querySelector<HTMLElement>('[data-item-id="hotel"]')?.closest<HTMLElement>(".trip-workspace-day")?.hidden).toBe(false);
    dayTabs[2]!.click();
    expect(f.ui.panel.querySelector<HTMLElement>('[data-item-id="hotel"]')?.closest<HTMLElement>(".trip-workspace-day")?.hidden).toBe(true);
    expect(f.ui.panel.querySelector<HTMLElement>('[data-item-id="activity"]')?.closest<HTMLElement>(".trip-workspace-day")?.hidden).toBe(false);
  });
  it("consults at the clicked day's first gap with a single free-text input, closing the modal without mutating Trip", () => {
    const trip = multiCityTrip(), before = structuredClone(trip), f = setup({ getCurrentTrip: () => trip }); f.ui.showPlan();
    const gap = f.ui.panel.querySelector<HTMLButtonElement>(".trip-timeline-add")!; gap.click();
    const form = document.querySelector<HTMLFormElement>("dialog .trip-workspace-add")!, dialog = form.closest("dialog")!;
    expect(dialog.open).toBe(true); expect(form.querySelector("select")).toBeNull();
    expect(form.textContent).not.toContain("追加案を確認"); expect(f.ui.panel.textContent).not.toContain("この後に追加");
    form.querySelector("textarea")!.value = "湖畔の景色のいいところで休憩したい";
    expect(form.querySelector("input")).toBeNull();
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(dialog.open).toBe(false); expect(f.app.dataset.tripWorkspaceView).toBe("chat");
    expect(f.ask).toHaveBeenCalledWith(expect.stringContaining("最初の予定"));
    expect(f.ask).toHaveBeenCalledWith(expect.stringContaining("希望：湖畔の景色のいいところで休憩したい"));
    expect(f.controller.current()).toEqual(before); expect(f.controller.proposal()).toBeUndefined();
    expect(f.controller.uiFocus()).toBeUndefined();
  });
  it("keeps an empty trip's addition unscheduled and prevents viewer additions", () => {
    const trip = createTrip(placesTripId, "未定の旅", placesAt), f = setup({ getCurrentTrip: () => trip });
    button(f.ui.panel, "＋ 予定を追加").click();
    const form = document.querySelector<HTMLFormElement>("dialog .trip-workspace-add")!;
    form.querySelector("textarea")!.value = "温泉に行きたい"; form.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(f.ask).toHaveBeenCalledWith(expect.stringContaining("日時未定の旅程"));
    const viewer = setup({ getCurrentTrip: multiCityTrip, getRole: () => "viewer" });
    expect(viewer.ui.panel.querySelector(".trip-timeline-add")).toBeNull();
    expect(button(viewer.ui.panel, "＋ 予定を追加").hidden).toBe(true);
  });
  it("displays the source and as-of date for a chosen place after it is saved in the Trip", () => {
    const trip = createTrip(placesTripId, "出雲の旅", placesAt, [{ id: "garden", title: "青葉庭園", type: "activity",
      category: "sightseeing", schedule: { type: "day", date: "2026-10-01" }, place: { name: "青葉庭園", sources: [] },
      research: { sourceUrl: "https://example.org/garden", observedAt: "2026-09-26T10:00:00Z" } }]);
    const f = setup({ getCurrentTrip: () => trip }); f.ui.showPlan();
    const item = f.ui.panel.querySelector<HTMLElement>('[data-item-id="garden"]')!;
    expect(item.textContent).toContain("2026/09/26 19:00:00");
    const source = item.querySelector<HTMLAnchorElement>(".trip-workspace-research-source")!;
    expect(source.href).toBe("https://example.org/garden");
    expect(source.rel).toBe("noopener noreferrer");
  });
  it("automatically refreshes on entering Trip once and keeps viewers read-only", async () => {
    const fixture = tripWeatherFixture(), refreshWeather = vi.fn(async () => {});
    const f = setup({ getCurrentTrip: () => fixture.trip, confirmProposal: async () => {} }, undefined, { refreshWeather });
    expect(refreshWeather).not.toHaveBeenCalled(); f.ui.showPlan();
    await vi.waitFor(() => expect(refreshWeather).toHaveBeenCalledOnce());
    f.ui.render(); f.ui.showPlan(); await Promise.resolve(); expect(refreshWeather).toHaveBeenCalledOnce();
    expect(f.ui.panel.textContent).toContain("雨 15〜22℃"); expect(button(f.ui.panel, "天気を更新")).toBeUndefined();
    const viewer = setup({ getCurrentTrip: () => fixture.trip, getRole: () => "viewer" }, undefined, { refreshWeather }); viewer.ui.showPlan();
    await Promise.resolve(); expect(refreshWeather).toHaveBeenCalledOnce();
  });
  it("shows confirmed item badges without booking/cost pencils and retains editable memo", () => {
    const fixture = tripWeatherFixture();
    const item = { ...fixture.item, decision: { confirmedAt: "2026-09-26T10:00:00Z" } };
    const trip = { ...fixture.trip, items: [item] }; const f = setup({ getCurrentTrip: () => trip });
    const card = f.ui.panel.querySelector<HTMLElement>('[data-item-id="visit"]')!;
    expect(card.querySelector(".trip-workspace-item-decision")?.textContent).toBe("確定");
    expect(card.querySelector<HTMLButtonElement>(".trip-item-booking .trip-field-pencil")!.hidden).toBe(true);
    expect(card.querySelector(".trip-item-cost .trip-field-pencil")).toBeNull();
    expect(card.querySelector<HTMLTextAreaElement>(".trip-item-memo textarea")!.readOnly).toBe(false);
    expect(card.textContent).not.toContain("天気を踏まえて相談"); expect(card.textContent).not.toContain("場所の変更案を確認");
  });
  it("opens a bounded travel mode and drops a delayed response after Trip switch", async () => {
    const first = inTripFixture(); let resolve!: (value: InTripContextSnapshot | undefined) => void;
    const load = vi.fn(() => new Promise<InTripContextSnapshot | undefined>((done) => { resolve = done; }));
    const f = setup({ getCurrentTrip: () => first.trip }, load);
    void f.ui.openTravelMode(); expect(f.ui.panel.textContent).toContain("確認しています");
    const other = createTrip("22222222-2222-4222-8222-222222222222", "別の旅", placesAt);
    f.controller.attach("two", { getCurrentTrip: () => other }); f.controller.activateSession("two"); resolve(first.snapshot);
    await Promise.resolve(); expect(f.ui.panel.textContent).not.toContain(first.snapshot.impacts.items[0]?.observedAt ?? "never");
    expect(f.ui.panel.textContent).toContain("別の旅");
    void f.ui.openTravelMode();
    expect(load).toHaveBeenCalledTimes(1); expect(f.ui.panel.textContent).toContain("プレビュー");
    button(f.ui.panel, "旅程詳細へ戻る").click(); expect(f.ui.panel.querySelector(".trip-detail-panel")).not.toBeNull();
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
  it("requires explicit UI confirmation for adoption", async () => {
    const trip = createTrip(placesTripId, "出雲の旅", placesAt, [{ id: "visit", title: "出雲大社", type: "activity", category: "sightseeing",
      schedule: { type: "day", date: "2026-10-01", timeZone: "Asia/Tokyo" } }]);
    const changeAdoption = vi.fn(async () => undefined), branchTrip = vi.fn(async () => undefined);

    const f = setup({ getCurrentTrip: () => trip }, undefined, { changeAdoption, branchTrip });
    button(f.ui.panel, "旅程を確定").click();
    expect(changeAdoption).not.toHaveBeenCalled();
    document.querySelector<HTMLButtonElement>("dialog.app-dialog button[type=submit]")!.click();
    await vi.waitFor(() => expect(changeAdoption).toHaveBeenCalledWith(trip, "confirm"));
    expect(button(f.ui.panel, "この旅程を分岐")).toBeUndefined();
    expect(branchTrip).not.toHaveBeenCalled();
  });
  it("shows item confirmation separate from Trip adoption and never shows it to a viewer", async () => {
    const trip = createTrip(placesTripId, "出雲", placesAt, [{ id: "visit", title: "出雲大社", type: "activity", category: "sightseeing",
      schedule: { type: "day", date: "2026-10-01" }, place: { name: "出雲大社", sources: [] } }]);
    const changeItemDecision = vi.fn(async () => undefined);
    const f = setup({ getCurrentTrip: () => trip, getRole: () => "owner" }, undefined, { changeItemDecision });
    f.ui.showPlan();
    expect(f.ui.panel.textContent).toContain("下書き");
    button(f.ui.panel, "この予定を確定").click();
    document.querySelector<HTMLButtonElement>("dialog.app-dialog button[type=submit]")!.click();
    await vi.waitFor(() => expect(changeItemDecision).toHaveBeenCalledWith(trip, trip.items[0], "confirm"));
    f.controller.attach("viewer", { getCurrentTrip: () => trip, getRole: () => "viewer" }); f.controller.activateSession("viewer");
    expect(button(f.ui.panel, "この予定を確定")).toBeUndefined();
  });
  it.each(["経路1: 向日町駅→出雲市駅", "向日町駅→出雲市駅（経路1）"])("places disclosure before the title and hides route numbering in %s", title => {
    const base = multiCityTrip(), route = base.items.find(item => item.type === "transport")!;
    const trip = { ...base, items: base.items.map(item => item.id === route.id ? { ...item, title } : item) };
    const f = setup({ getCurrentTrip: () => trip });
    const card = f.ui.panel.querySelector<HTMLElement>(`[data-item-id="${route.id}"]`)!;
    const header = card.querySelector("header")!;
    expect(header.firstElementChild?.classList.contains("trip-item-toggle")).toBe(true);
    expect(header.querySelector(".trip-workspace-item-focus")?.textContent).toBe("向日町駅→出雲市駅");
    expect(header.textContent).not.toContain("経路1");
    expect(header.querySelector(".trip-item-consult")?.textContent).toBe("相談");
    const body = card.querySelector<HTMLElement>(".trip-workspace-item-body")!;
    expect(body.hidden).toBe(true);
    expect(header.querySelector(".trip-workspace-item-decision")?.textContent).toBe("下書き");
    expect(header.querySelector(".trip-item-consult")?.previousElementSibling?.classList.contains("trip-workspace-item-decision")).toBe(true);
    expect(card.querySelector(".trip-warning-box")?.closest(".trip-workspace-item-body")).toBe(body);
    expect(card.querySelector(".trip-item-cost")?.closest(".trip-workspace-item-body")).toBe(body);
    expect(card.querySelector(".trip-route")?.closest(".trip-workspace-item-body")).toBe(body);
    expect(card.querySelector(".trip-workspace-move-target,.trip-workspace-day-target")).toBeNull();
    header.querySelector<HTMLButtonElement>(".trip-item-toggle")!.click();
    expect(header.querySelector(".trip-item-toggle")?.getAttribute("aria-expanded")).toBe("true");
    expect(trip.items.find(item => item.id === route.id)?.title).toBe(title);
  });
  it("groups manual transport fields and saves directly without a proposal panel", async () => {
    const base = multiCityTrip(), route = base.items.find(item => item.type === "transport")!;
    const trip = { ...base, items: base.items.map(item => item.id === route.id ? { ...item, detail: { status: "unresolved" as const } } : item) };
    const save = vi.fn(async (_proposal: import("@raiquora/trip/trip").TripUpdateProposal) => {});
    const f = setup({ getCurrentTrip: () => trip, confirmProposal: save });
    const card = f.ui.panel.querySelector<HTMLElement>(`[data-item-id="${route.id}"]`)!;
    expect(card.querySelector(".trip-route")).toBeNull();
    const form = card.querySelector<HTMLFormElement>(".trip-workspace-manual-transport")!;
    const disclosure = form.closest("details")!;
    expect(disclosure.querySelector("summary")?.textContent).toBe("手入力");
    expect(disclosure.open).toBe(false);
    expect(form.querySelectorAll(".trip-manual-transport-fields label")).toHaveLength(3);
    expect([...form.querySelectorAll("option")].map(o => o.textContent)).toEqual(["飛行機", "バス", "フェリー", "車", "レンタカー", "タクシー", "配車", "徒歩", "自転車", "移動"]);
    form.querySelector("select")!.value = "air";
    const fields = form.querySelectorAll("input"); fields[0]!.value = "大阪"; fields[1]!.value = "東京";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0]![0].patches[0]).toMatchObject({ type: "replace", item: { detail: { mode: "air", origin: { name: "大阪" }, destination: { name: "東京" } } } });
  });
  it("preserves input, session, both scroll positions, focus, collapse and proposal through chat/trip/chat", () => {
    const f = setup({ getCurrentTrip: multiCityTrip }); f.input.value = "編集中の文章"; f.messages.scrollTop = 240; f.input.focus();
    f.controller.focus("activity"); f.controller.propose("順序変更", [{ type: "move", itemId: "activity" }]);
    button(f.ui.nav, "旅程").click(); f.ui.panel.scrollTop = 330;
    const card = f.ui.panel.querySelector<HTMLElement>('[data-item-id="activity"]')!;
    card.querySelector<HTMLButtonElement>(".trip-item-toggle")!.click(); card.querySelector<HTMLButtonElement>(".trip-item-toggle")!.click(); expect(card.querySelector<HTMLButtonElement>(".trip-item-toggle")!.getAttribute("aria-expanded")).toBe("false");
    button(f.ui.nav, "会話").click();
    expect(f.input.value).toBe("編集中の文章"); expect(document.activeElement).toBe(f.input); expect(f.messages.scrollTop).toBe(240);
    expect(f.controller.sessionId()).toBe("one"); expect(f.controller.uiFocus()?.itemId).toBe("activity"); expect(f.controller.proposal()?.summary).toBe("順序変更");
    button(f.ui.nav, "旅程").click(); expect(f.ui.panel.scrollTop).toBe(330); expect(card.querySelector<HTMLButtonElement>(".trip-item-toggle")!).toBeDefined();
    expect(button(f.ui.nav, "旅程").getAttribute("aria-pressed")).toBe("true");
    expect(f.app.contains(f.chat)).toBe(true); expect(f.ui.panel.querySelectorAll(".trip-order-preview")).toHaveLength(1);
  });
  it("renames an item through the popup and saves without a separate proposal panel", async () => {
    let trip = multiCityTrip(); const f = setup({ getCurrentTrip: () => trip, confirmProposal: async p => { trip = applyTripProposal(trip, p); } });
    const oldHotel = f.ui.panel.querySelector('[data-item-id="hotel"]');
    const activity = f.ui.panel.querySelector<HTMLElement>('[data-item-id="activity"]')!;
    activity.querySelector<HTMLButtonElement>(".trip-item-rename")!.click();
    const input = document.querySelector<HTMLInputElement>("dialog.app-dialog input")!;
    expect(document.activeElement).toBe(input); expect(input.value).toBe("Zürich");
    input.value = "ゆっくり散策"; document.querySelector<HTMLButtonElement>("dialog.app-dialog button[type=submit]")!.click();
    await vi.waitFor(() => expect(trip.items[2]?.title).toBe("ゆっくり散策"));
    expect(f.controller.proposal()).toBeUndefined(); expect(activity.querySelector(".trip-workspace-editor")).toBeNull();
    expect(f.ui.panel.querySelector('[data-item-id="hotel"]')).toBe(oldHotel);
  });
  it("remove/move use the shared proposal path and consultation sends intent with focus", () => {
    const trip = multiCityTrip(), f = setup({ getCurrentTrip: () => trip });
    const activity = f.ui.panel.querySelector<HTMLElement>('[data-item-id="activity"]')!;
    expect(activity.querySelector(".trip-workspace-move-target")).toBeNull();
    expect(button(f.ui.panel, "並び替え")?.parentElement).toBe(f.ui.panel.querySelector(".trip-itinerary-heading"));
    expect(f.ui.panel.querySelector(".trip-workspace-day > h2")).toBeNull();
    expect(activity.querySelector(".trip-workspace-day-target")).toBeNull();
    expect(button(activity, "日付変更案")).toBeUndefined();
    button(activity, "相談").click(); expect(f.ask).toHaveBeenCalledWith(`相談対象：旅程「${trip.title}」の3番目の予定「Zürich」。\nこの予定を相談したい`); expect(f.controller.uiFocus()).toEqual({ itemId: "activity" });
    expect(f.app.dataset.tripWorkspaceView).toBe("chat"); expect(trip.items).toHaveLength(3);
    button(activity, "相談").click();
    expect(f.ask).toHaveBeenLastCalledWith(expect.stringContaining('3番目の予定「Zürich」。\nこの予定を相談したい'));
    const hotel = f.ui.panel.querySelector<HTMLElement>('[data-item-id="hotel"]')!;
    expect(button(hotel, "宿候補を相談")).toBeUndefined();
    button(hotel, "相談").click();
    expect(f.ask).toHaveBeenLastCalledWith(expect.stringContaining('2番目の予定「宿泊」（2026-09-22）。\nこの予定'));
    expect(f.controller.uiFocus()).toEqual({ itemId: "hotel" });
  });
  it("keeps candidate assessment outside adopted cards; unknown is not fine weather or zero price", () => {
    const f = setup(tripWorkspacePreviewSource()); const before = structuredClone(f.controller.current());
    expect(f.ui.panel.querySelector(".trip-workspace-candidates")).toBeNull();
    expect(f.ui.panel.textContent).toContain("未採用の提案があります");
    expect(f.ui.panel.textContent).toContain("EUR 120.00");
    expect(f.ui.panel.querySelector(".trip-party-control")?.textContent).toContain("大人"); expect(f.controller.current()).toEqual(before);
  });
  it("session change drops neither proposals nor selection; another Trip does not receive them", () => {
    const f = setup({ getCurrentTrip: multiCityTrip }); f.controller.focus("activity"); f.controller.propose("削除", [{ type: "remove", itemId: "activity" }]);
    f.controller.attach("two", { getCurrentTrip: () => createTrip("22222222-2222-4222-8222-222222222222", "別の旅", placesAt, [placeActivity("other")]) });
    f.controller.activateSession("two"); expect(f.ui.panel.textContent).not.toContain("変更内容を確認"); expect(f.controller.uiFocus()).toBeUndefined();
    f.controller.activateSession("one"); expect(f.ui.panel.textContent).toContain("変更内容を確認"); expect(f.controller.uiFocus()?.itemId).toBe("activity");
  });
  it("restores the selected day when returning to a conversation", () => {
    const f = setup({ getCurrentTrip: multiCityTrip }); f.ui.showPlan();
    [...f.ui.panel.querySelectorAll<HTMLButtonElement>(".trip-day-tabs [role=tab]")].find(tab => tab.textContent === "日時未定")!.click();
    const other = createTrip("22222222-2222-4222-8222-222222222222", "別の旅", placesAt, [placeActivity("other")]);
    f.controller.attach("two", { getCurrentTrip: () => other }); f.controller.activateSession("two");
    expect(f.ui.panel.textContent).toContain("別の旅");
    f.controller.activateSession("one");
    expect([...f.ui.panel.querySelectorAll<HTMLButtonElement>(".trip-day-tabs [role=tab]")].find(tab => tab.textContent === "日時未定")?.getAttribute("aria-selected")).toBe("true");
  });
});
it("puts Trip confirmation and sharing in the header and explains missing schedules", () => {
  const trip = createTrip(placesTripId, "計画中", placesAt, [{ id: "a", type: "activity", category: "sightseeing", title: "海", schedule: { type: "unscheduled" } }]);
  const f = setup({ getCurrentTrip: () => trip }, undefined, { changeAdoption: vi.fn(async () => {}) });
  const heading = f.ui.panel.querySelector("header")!;
  expect(button(heading, "旅程を確定").disabled).toBe(true); expect(heading.textContent).toContain("日程を設定すると確定");
  expect([...heading.querySelectorAll(".trip-header-actions button")].map(button => button.textContent)).toEqual(["旅程を確定", "共有"]);
  expect(heading.querySelector(".trip-header-management")).toBeNull();
  expect(heading.textContent).not.toContain("この旅について相談");
  expect(heading.textContent).not.toContain("旅行モード");
});

it("edits the header title manually and hides editing for shared viewers", async () => {
  const trip = multiCityTrip(); const renameTitle = vi.fn(async () => {});

  const f = setup({ getCurrentTrip: () => trip }, undefined, { renameTitle }); f.ui.showPlan();
  const edit = f.ui.panel.querySelector<HTMLButtonElement>('[aria-label="旅程の名称を編集"]')!;
  expect(edit.querySelector("svg")).not.toBeNull(); edit.click();
  document.querySelector<HTMLInputElement>("dialog.app-dialog input")!.value = "  新しい旅の名称  ";
  document.querySelector<HTMLButtonElement>("dialog.app-dialog button[type=submit]")!.click();
  await vi.waitFor(() => expect(renameTitle).toHaveBeenCalledExactlyOnceWith(trip, "新しい旅の名称"));

  f.controller.attach("viewer", { getCurrentTrip: () => trip, getRole: () => "viewer" }); f.controller.activateSession("viewer");
  expect(edit.hidden).toBe(true); edit.click(); expect(renameTitle).toHaveBeenCalledTimes(1);
});

it("hides consultation for confirmed items and permits returning to draft", async () => {
  const base = multiCityTrip(), item = base.items[2]!;
  const trip = { ...base, items: base.items.map(i => i.id === item.id ? { ...i, decision: { confirmedAt: placesAt } } : i) };
  const changeItemDecision = vi.fn(async () => {});
  const f = setup({ getCurrentTrip: () => trip }, undefined, { changeItemDecision });
  const card = f.ui.panel.querySelector<HTMLElement>('[data-item-id="activity"]')!;
  expect(button(card, "相談")).toBeUndefined();
  expect(card.querySelector("details.trip-workspace-editing")).toBeNull();
  button(card, "下書きに戻す").click();
  document.querySelector<HTMLButtonElement>("dialog.app-dialog button[type=submit]")!.click();
  await vi.waitFor(() => expect(changeItemDecision).toHaveBeenCalledWith(trip, trip.items[2], "withdraw"));
});
it("deletes only after confirmation without showing a proposal panel, and preserves an item on failure", async () => {
  let trip = multiCityTrip();
  const save = vi.fn(async (proposal: Parameters<typeof applyTripProposal>[1]) => { trip = applyTripProposal(trip, proposal); });
  const f = setup({ getCurrentTrip: () => trip, confirmProposal: save });
  const card = f.ui.panel.querySelector<HTMLElement>('[data-item-id="activity"]')!;
  button(card, "削除").click(); expect(save).not.toHaveBeenCalled(); expect(trip.items).toHaveLength(3);
  document.querySelector<HTMLButtonElement>("dialog.app-dialog button[type=button]")!.click();
  await Promise.resolve();
  button(card, "削除").click();
  document.querySelector<HTMLButtonElement>("dialog.app-dialog button[type=submit]")!.click();
  expect(f.ui.panel.textContent).not.toContain("変更内容を確認");
  await vi.waitFor(() => expect(trip.items).toHaveLength(2)); expect(f.controller.proposal()).toBeUndefined();
  const remaining = f.ui.panel.querySelector<HTMLElement>('[data-item-id="movement"]')!;
  save.mockRejectedValueOnce(new Error("保存失敗")); button(remaining, "削除").click();
  document.querySelector<HTMLButtonElement>("dialog.app-dialog button[type=submit]")!.click();
  await Promise.resolve();
  await vi.waitFor(() => expect(f.controller.proposal()).toBeUndefined());
  expect(trip.items).toHaveLength(2);
});

it("saves item memo directly as plain text and gives viewers a read-only field", async () => {
  let trip = multiCityTrip();
  const save = vi.fn(async p => { trip = { ...applyTripProposal(trip, p), revision: trip.revision + 1 }; });
  const f = setup({ getCurrentTrip: () => trip, confirmProposal: save });
  const form = f.ui.panel.querySelector<HTMLFormElement>('[data-item-id="activity"] .trip-item-memo')!;
  form.querySelector("textarea")!.value = "集合場所\n<script>unsafe()</script> **そのまま**";
  form.querySelector("textarea")!.dispatchEvent(new Event("blur"));
  await vi.waitFor(() => expect(trip.items[2]?.memo).toBe("集合場所\n<script>unsafe()</script> **そのまま**"));
  expect(f.controller.proposal()).toBeUndefined(); expect(f.ui.panel.querySelector(".trip-item-memo script")).toBeNull();
  expect(form.querySelector("button")).toBeNull();
  const viewer = setup({ getCurrentTrip: () => trip, getRole: () => "viewer" });
  const field = viewer.ui.panel.querySelector<HTMLTextAreaElement>('[data-item-id="activity"] .trip-item-memo textarea')!;
  expect(field.readOnly).toBe(true); expect(field.value).toBe(trip.items[2]?.memo);
  expect(field.closest("form")!.querySelector("button")).toBeNull();
  form.querySelector("textarea")!.dispatchEvent(new Event("blur"));
  expect(save).toHaveBeenCalledOnce();
});

it("warns with unmarked hotel names and allows cancelling or continuing Trip confirmation", async () => {
 const trip = createTrip(placesTripId, "旅", placesAt, [{ id: "hotel", title: "テストホテル", type: "stay",
   selection: { status: "unselected" }, schedule: { type: "day", date: "2026-10-12", timeZone: "Asia/Tokyo" } }]);
 const changeAdoption = vi.fn(async () => undefined);
 const f = setup({ getCurrentTrip: () => trip }, undefined, { changeAdoption });
 button(f.ui.panel, "旅程を確定").click();
 expect(document.querySelector("dialog")?.textContent).toContain("テストホテル");
 expect(document.querySelector("dialog")?.textContent).toContain("未確認");
 document.querySelector<HTMLButtonElement>("dialog button[type=button]")!.click();
 await Promise.resolve(); expect(changeAdoption).not.toHaveBeenCalled();
 button(f.ui.panel, "旅程を確定").click();
 document.querySelector<HTMLButtonElement>("dialog button[type=submit]")!.click();
 await vi.waitFor(() => expect(changeAdoption).toHaveBeenCalledWith(trip, "confirm"));
});

it("saves booking marks through a revision-bound proposal and disables them for viewers", async () => {
 const trip = multiCityTrip(), confirmProposal = vi.fn(async (_proposal: unknown) => undefined);
 const f = setup({ getCurrentTrip: () => trip, confirmProposal, getRole: () => "owner" });
 const input = f.ui.panel.querySelector<HTMLSelectElement>(".trip-item-booking select")!;
 input.value = "booked"; input.dispatchEvent(new Event("change"));
 await vi.waitFor(() => expect(confirmProposal).toHaveBeenCalled());
 const proposal = confirmProposal.mock.calls[0]![0] as unknown as { baseRevision: number; patches: { type: string; status: string }[] };
 expect(proposal.baseRevision).toBe(trip.revision); expect(proposal.patches[0]).toMatchObject({ type: "item_booking", status: "booked" });
 f.app.remove();
 const viewer = setup({ getCurrentTrip: () => trip, confirmProposal, getRole: () => "viewer" });
 expect(viewer.ui.panel.querySelector<HTMLSelectElement>(".trip-item-booking select")!.disabled).toBe(true);
});

it("keeps failed memo drafts in memory and never overwrites a newer shared memo", async () => {
 const original = multiCityTrip(); let current: typeof original | undefined = original;
 const save = vi.fn(async () => { current = undefined; throw new Error("network"); });
 const f = setup({ getCurrentTrip: () => current, confirmProposal: save });
 const field = f.ui.panel.querySelector<HTMLTextAreaElement>('[data-item-id="activity"] .trip-item-memo textarea')!;
 field.value = "入力を保持"; field.dispatchEvent(new Event("input")); field.dispatchEvent(new Event("blur"));
 await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
 await vi.waitFor(() => expect(f.controller.proposal()).toBeUndefined());
 current = original; f.controller.refresh();
 expect(f.ui.panel.querySelector<HTMLTextAreaElement>('[data-item-id="activity"] .trip-item-memo textarea')!.value).toBe("入力を保持");
 current = { ...original, revision: original.revision + 1, items: original.items.map(item => item.id === "activity" ? { ...item, memo: "別の編集者のメモ" } : item) }; f.controller.refresh();
 const recovered = f.ui.panel.querySelector<HTMLTextAreaElement>('[data-item-id="activity"] .trip-item-memo textarea')!;
 expect(recovered.value).toBe("入力を保持"); recovered.dispatchEvent(new Event("blur"));
 await Promise.resolve(); expect(save).toHaveBeenCalledOnce(); expect(current.items.find(item => item.id === "activity")!.memo).toBe("別の編集者のメモ");
});

it("serializes memo blur and booking changes using the latest saved revision", async () => {
 let trip = multiCityTrip();
 const save = vi.fn(async proposal => {
   await Promise.resolve();
   expect(proposal.baseRevision).toBe(trip.revision);
   trip = { ...applyTripProposal(trip, proposal), revision: trip.revision + 1 };
 });
 const f = setup({ getCurrentTrip: () => trip, confirmProposal: save });
 const card = f.ui.panel.querySelector<HTMLElement>('[data-item-id="activity"]')!;
 const memo = card.querySelector<HTMLTextAreaElement>(".trip-item-memo textarea")!;
 memo.value = "集合場所"; memo.dispatchEvent(new Event("blur"));
 const booking = card.querySelector<HTMLSelectElement>(".trip-item-booking select")!;
 booking.value = "booked"; booking.dispatchEvent(new Event("change"));
 await vi.waitFor(() => expect(trip.items.find(item => item.id === "activity")).toMatchObject({ memo: "集合場所", bookingStatus: "booked" }));
 expect(save).toHaveBeenCalledTimes(2); expect(f.controller.proposal()).toBeUndefined();
 const updatedMemo = f.ui.panel.querySelector<HTMLTextAreaElement>('[data-item-id="activity"] .trip-item-memo textarea')!;
 updatedMemo.value = "集合場所を更新"; updatedMemo.dispatchEvent(new Event("blur"));
 await vi.waitFor(() => expect(trip.items.find(item => item.id === "activity")!.memo).toBe("集合場所を更新"));
 expect(save).toHaveBeenCalledTimes(3);
});
