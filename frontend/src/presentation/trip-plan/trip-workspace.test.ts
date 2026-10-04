// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTripProposal, createTrip } from "@raiquora/trip/trip";
import type { TripUpdateProposal } from "@raiquora/trip/trip";
import { multiCityTrip, placeActivity, placesAt, placesTripId } from "../../../../modules/trip/domain/trip-places.fixture";
import { tripWorkspacePreviewSource } from "../../dev/trip-workspace-preview";
import { createTripWorkspaceController, type TripWorkspaceSource } from "../../usecases/trip-plan/trip-workspace-controller";
import { configureTripWorkspace } from "./trip-workspace";
import { createServerTripWorkspaceSource } from "../../usecases/trip-plan/server-trip-workspace-source";
import { costForecast } from "../../../../modules/trip/domain/trip-costs.fixture";
import { inTripFixture } from "../../../../modules/trip/domain/in-trip-context.fixture";
import type { InTripContextSnapshot } from "@raiquora/trip/in-trip-context";
import { parsePublicPlanPresentation } from "@raiquora/agent/public-plan-presentation";

function setup(source?: TripWorkspaceSource, loadInTripContext?: (tripId: string) => Promise<InTripContextSnapshot | undefined>,
  actions: Partial<Pick<Parameters<typeof configureTripWorkspace>[0], "changeAdoption" | "changeItemDecision" | "branchTrip" | "conversationId" | "onPlanAdoption">> = {}) {
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
  it("shows an unsaved draft on the itinerary screen and requires preview then explicit save", async () => {
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
    expect(f.ui.panel.textContent).toContain("未保存の旅程案"); expect(f.ui.panel.textContent).toContain("出雲大社を参拝");
    expect(trip.items).toEqual([]); expect(adopt).not.toHaveBeenCalled();
    button(f.ui.panel, "この案を採用する").click();
    await vi.waitFor(() => expect(button(f.ui.panel, "この変更を確認して保存")).toBeDefined());
    expect(adopt).toHaveBeenCalledWith(expect.objectContaining({ conversationId: "one", tripId: trip.id, baseTripRevision: trip.revision }));
    expect(confirm).not.toHaveBeenCalled(); button(f.ui.panel, "この変更を確認して保存").click(); await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    f.controller.activateSession("two"); expect(f.controller.plan()).toBeUndefined();
  });
  it("opens the timeline directly and retains useful controls in details", () => {
    const f = setup({ getCurrentTrip: multiCityTrip }); f.ui.showPlan();
    expect(f.ui.panel.querySelector(".trip-detail-tabs")).toBeNull();
    expect(f.ui.panel.querySelector("#trip-detail-map")).toBeNull();
    expect(f.ui.panel.querySelector(".trip-workspace-days")).not.toBeNull();
    const details = f.ui.panel.querySelector<HTMLDetailsElement>(".trip-extra-details")!;
    expect(details.open).toBe(false); expect(details.textContent).toContain("旅程の詳細");
    expect(f.controller.current()).toEqual(multiCityTrip());
  });
  it("derives day tabs from authored schedules and keeps unscheduled items separate", () => {
    const f = setup({ getCurrentTrip: multiCityTrip });
    f.ui.showPlan();
    const dayTabs = [...f.ui.panel.querySelectorAll<HTMLButtonElement>(".trip-day-tabs [role=tab]")];
    expect(dayTabs.map((tab) => tab.textContent)).toEqual(["2026-09-22", "2026-09-23", "日時未定"]);
    expect(f.ui.panel.querySelectorAll<HTMLElement>('.trip-workspace-days [data-item-id="hotel"]').length).toBe(2);
    expect(f.ui.panel.querySelector<HTMLElement>('[data-item-id="hotel"]')?.closest<HTMLElement>(".trip-workspace-day")?.hidden).toBe(false);
    dayTabs[2]!.click();
    expect(f.ui.panel.querySelector<HTMLElement>('[data-item-id="hotel"]')?.closest<HTMLElement>(".trip-workspace-day")?.hidden).toBe(true);
    expect(f.ui.panel.querySelector<HTMLElement>('[data-item-id="activity"]')?.closest<HTMLElement>(".trip-workspace-day")?.hidden).toBe(false);
  });
  it("previews a selected day's meal without persisting a candidate or inventing a venue", async () => {
    const trip = createTrip(placesTripId, "出雲の旅", placesAt, [
      { id: "shrine", title: "出雲大社", type: "activity", category: "sightseeing", schedule: { type: "day", date: "2026-10-01", timeZone: "Asia/Tokyo" } },
      { id: "hotel", title: "宿未定", type: "stay", selection: { status: "unselected" }, schedule: { type: "day", date: "2026-10-02", timeZone: "Asia/Tokyo" } },
    ]);
    const confirmProposal = vi.fn(async (_proposal: TripUpdateProposal) => undefined);
    const f = setup({ getCurrentTrip: () => trip, confirmProposal });
    f.ui.showPlan();
    button(f.ui.panel, "＋ 予定を追加").click(); const form = f.ui.panel.querySelector<HTMLFormElement>(".trip-workspace-add")!;
    const [title, category, day] = [form.querySelector("input")!, form.querySelectorAll("select")[0]!, form.querySelectorAll("select")[1]!];
    expect([...day.options].map((o) => o.textContent)).toEqual(["日時未定", "2026-10-01", "2026-10-02"]);
    title.value = "昼食"; category.value = "food"; day.value = day.options[2]!.value;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(trip.items).toHaveLength(2);
    expect(f.controller.proposal()?.patches[0]).toMatchObject({ type: "add", item: { id: "new-free", category: "food", schedule: { type: "day", date: "2026-10-02", timeZone: "Asia/Tokyo" } } });
    expect(f.ui.panel.textContent).toContain("まだ反映");
    await f.controller.confirm();
    expect(confirmProposal).toHaveBeenCalledTimes(1);
    const savedPatch = confirmProposal.mock.calls[0]![0].patches[0];
    if (savedPatch?.type !== "add") throw new Error("Expected an added activity");
    expect(savedPatch.item).not.toHaveProperty("place");
  });
  it("previews an explicitly entered place name without claiming a verified search candidate", () => {
    const trip = createTrip(placesTripId, "出雲の旅", placesAt, [{ id: "shrine", title: "出雲大社", type: "activity",
      category: "sightseeing", schedule: { type: "day", date: "2026-10-01" } }]);
    const f = setup({ getCurrentTrip: () => trip }); f.ui.showPlan();
    button(f.ui.panel, "＋ 予定を追加").click(); const form = f.ui.panel.querySelector<HTMLFormElement>(".trip-workspace-add")!;
    const [title, place] = form.querySelectorAll<HTMLInputElement>("input");
    title!.value = "昼食"; place!.value = "出雲そばの店";
    form.querySelectorAll("select")[0]!.value = "food";
    form.querySelectorAll("select")[1]!.selectedIndex = 1;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(f.controller.proposal()?.patches[0]).toMatchObject({ type: "add", item: {
      category: "food", place: { name: "出雲そばの店", sources: [] }, schedule: { type: "day", date: "2026-10-01" },
    } });
    expect(trip.items).toHaveLength(1);
    expect(f.ui.panel.textContent).toContain("手入力");
  });
  it("displays the source and as-of date for a chosen place after it is saved in the Trip", () => {
    const trip = createTrip(placesTripId, "出雲の旅", placesAt, [{ id: "garden", title: "青葉庭園", type: "activity",
      category: "sightseeing", schedule: { type: "day", date: "2026-10-01" }, place: { name: "青葉庭園", sources: [] },
      research: { sourceUrl: "https://example.org/garden", observedAt: "2026-09-26T10:00:00Z" } }]);
    const f = setup({ getCurrentTrip: () => trip }); f.ui.showPlan();
    const item = f.ui.panel.querySelector<HTMLElement>('[data-item-id="garden"]')!;
    expect(item.textContent).toContain("参照資料は2026/9/26時点");
    const source = item.querySelector<HTMLAnchorElement>(".trip-workspace-research-source")!;
    expect(source.href).toBe("https://example.org/garden");
    expect(source.rel).toBe("noopener noreferrer");
  });
  it("starts a weather discussion for one Trip activity without changing the confirmed itinerary", () => {
    const trip = createTrip(placesTripId, "出雲の旅", placesAt, [{ id: "shrine", title: "出雲大社", type: "activity",
      category: "sightseeing", schedule: { type: "day", date: "2026-10-01" }, place: { name: "出雲大社", area: "出雲市", sources: [] },
      decision: { confirmedAt: "2026-09-26T10:00:00Z" } }]);
    const f = setup({ getCurrentTrip: () => trip }); f.ui.showPlan();
    const item = f.ui.panel.querySelector<HTMLElement>('[data-item-id="shrine"]')!;
    button(item, "天気を踏まえて相談").click();
    expect(f.controller.uiFocus()).toEqual({ itemId: "shrine" });
    expect(f.ask).toHaveBeenCalledWith(expect.stringContaining("日付と地域の天気を確認"));
    expect(f.controller.proposal()).toBeUndefined();
    expect(trip.items[0]?.decision).toMatchObject({ confirmedAt: "2026-09-26T10:00:00Z" });
  });
  it("does not discard an unsubmitted cost edit while switching detail tabs", () => {
    const base = multiCityTrip();
    const trip = applyTripProposal(base, { tripId: base.id, baseRevision: base.revision, summary: "概算", patches: [
      { type: "cost_forecast", forecast: costForecast(base.id, base.revision) },
    ] });
    const f = setup({ getCurrentTrip: () => trip, confirmProposal: async () => undefined });
    const details = f.ui.panel.querySelector<HTMLDetailsElement>(".trip-extra-details")!; details.open = true; button(f.ui.panel, "交通の金額を編集").click();
    const input = f.ui.panel.querySelector<HTMLInputElement>(".trip-cost-editor input")!; input.value = "12345";
    details.open = false; expect(input.isConnected).toBe(true);
    details.open = true; expect(f.ui.panel.querySelector<HTMLInputElement>(".trip-cost-editor input")?.value).toBe("12345");
  });
  it("opens a bounded travel mode and drops a delayed response after Trip switch", async () => {
    const first = inTripFixture(); let resolve!: (value: InTripContextSnapshot | undefined) => void;
    const load = vi.fn(() => new Promise<InTripContextSnapshot | undefined>((done) => { resolve = done; }));
    const f = setup({ getCurrentTrip: () => first.trip }, load);
    button(f.ui.panel, "旅行モードを開く").click(); expect(f.ui.panel.textContent).toContain("確認しています");
    const other = createTrip("22222222-2222-4222-8222-222222222222", "別の旅", placesAt);
    f.controller.attach("two", { getCurrentTrip: () => other }); f.controller.activateSession("two"); resolve(first.snapshot);
    await Promise.resolve(); expect(f.ui.panel.textContent).not.toContain(first.snapshot.impacts.items[0]?.observedAt ?? "never");
    expect(f.ui.panel.textContent).toContain("別の旅");
    button(f.ui.panel, "旅行モードを開く").click();
    expect(load).toHaveBeenCalledTimes(1); expect(f.ui.panel.textContent).toContain("プレビュー");
    button(f.ui.panel, "旅程詳細へ戻る").click(); expect(f.ui.panel.textContent).toContain("旅程の詳細");
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
  it("requires explicit UI confirmation for adoption and branches from the displayed revision", async () => {
    const trip = createTrip(placesTripId, "出雲の旅", placesAt, [{ id: "visit", title: "出雲大社", type: "activity", category: "sightseeing",
      schedule: { type: "day", date: "2026-10-01", timeZone: "Asia/Tokyo" } }]);
    const changeAdoption = vi.fn(async () => undefined), branchTrip = vi.fn(async () => undefined);
    vi.stubGlobal("confirm", vi.fn(() => true)); vi.stubGlobal("prompt", vi.fn(() => "雨の日案"));
    const f = setup({ getCurrentTrip: () => trip }, undefined, { changeAdoption, branchTrip });
    button(f.ui.panel, "この旅程で行く").click();
    await vi.waitFor(() => expect(changeAdoption).toHaveBeenCalledWith(trip, "confirm"));
    button(f.ui.panel, "この旅程を分岐").click();
    await vi.waitFor(() => expect(branchTrip).toHaveBeenCalledWith(trip, "雨の日案"));
  });
  it("shows item confirmation separate from Trip adoption and never shows it to a viewer", async () => {
    const trip = createTrip(placesTripId, "出雲", placesAt, [{ id: "visit", title: "出雲大社", type: "activity", category: "sightseeing",
      schedule: { type: "day", date: "2026-10-01" }, place: { name: "出雲大社", sources: [] } }]);
    const changeItemDecision = vi.fn(async () => undefined); vi.stubGlobal("confirm", vi.fn(() => true));
    const f = setup({ getCurrentTrip: () => trip, getRole: () => "owner" }, undefined, { changeItemDecision });
    f.ui.showPlan();
    expect(f.ui.panel.textContent).toContain("仮の予定");
    button(f.ui.panel, "この予定を確定").click();
    await vi.waitFor(() => expect(changeItemDecision).toHaveBeenCalledWith(trip, trip.items[0], "confirm"));
    f.controller.attach("viewer", { getCurrentTrip: () => trip, getRole: () => "viewer" }); f.controller.activateSession("viewer");
    expect(button(f.ui.panel, "この予定を確定")).toBeUndefined();
  });
  it("preserves input, session, both scroll positions, focus, collapse and proposal through chat/trip/chat", () => {
    const f = setup({ getCurrentTrip: multiCityTrip }); f.input.value = "編集中の文章"; f.messages.scrollTop = 240; f.input.focus();
    f.controller.focus("activity"); f.controller.propose("順序変更", [{ type: "move", itemId: "activity" }]);
    button(f.ui.nav, "旅程").click(); f.ui.panel.scrollTop = 330;
    const card = f.ui.panel.querySelector<HTMLElement>('[data-item-id="activity"]')!;
    button(card, "開く").click(); button(card, "閉じる").click(); expect(button(card, "開く").getAttribute("aria-expanded")).toBe("false");
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
    button(activity, "名称を変更").click(); const editor = activity.querySelector<HTMLFormElement>(".trip-workspace-editor")!, input = editor.querySelector("input")!;
    expect(document.activeElement).toBe(input); input.value = "ゆっくり散策"; editor.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(trip.items[2]?.title).toBe("Zürich"); expect(f.ui.panel.textContent).toContain("変更後");
    button(f.ui.panel, "確認して、この画面内に反映").click(); await vi.waitFor(() => expect(trip.items[2]?.title).toBe("ゆっくり散策"));
    expect(f.ui.panel.querySelector('[data-item-id="hotel"]')).toBe(oldHotel);
    expect(oldHotel?.querySelector('option[value="activity"]')?.textContent).toContain("ゆっくり散策");
    await vi.waitFor(() => expect(f.ui.panel.querySelector('[role="status"]')?.textContent).toContain("永続保存はしていません"));
  });
  it("add/remove/move use the shared proposal path and consultation sends intent with focus", () => {
    const trip = multiCityTrip(), f = setup({ getCurrentTrip: () => trip });
    button(f.ui.panel, "＋ 予定を追加").click(); const form = f.ui.panel.querySelector<HTMLFormElement>(".trip-workspace-add")!; form.querySelector("input")!.value = "休憩";
    form.dispatchEvent(new Event("submit", { cancelable: true })); expect(f.controller.proposal()?.patches[0]).toMatchObject({ type: "add", item: { id: "new-free" } });
    const activity = f.ui.panel.querySelector<HTMLElement>('[data-item-id="activity"]')!;
    button(activity, "削除案").click(); expect(f.controller.proposal()?.patches).toEqual([{ type: "remove", itemId: "activity" }]);
    activity.querySelector<HTMLSelectElement>("select")!.value = ""; button(activity, "移動案").click();
    expect(f.controller.proposal()?.patches).toEqual([{ type: "move", itemId: "activity" }]);
    const day = activity.querySelector<HTMLSelectElement>(".trip-workspace-day-target")!;
    day.value = [...day.options].find(option => option.textContent === "2026-09-22")!.value;
    button(activity, "日付変更案").click();
    expect(f.controller.proposal()?.patches[0]).toMatchObject({ type: "replace", itemId: "activity", item: { schedule: { type: "day", date: "2026-09-22" } } });
    button(activity, "相談する").click(); expect(f.ask).toHaveBeenCalledWith("この予定を相談したい"); expect(f.controller.uiFocus()).toEqual({ itemId: "activity" });
    expect(f.app.dataset.tripWorkspaceView).toBe("chat"); expect(trip.items).toHaveLength(3);
  });
  it("keeps candidate assessment outside adopted cards; unknown is not fine weather or zero price", () => {
    const f = setup(tripWorkspacePreviewSource()); const before = structuredClone(f.controller.current());
    const candidates = f.ui.panel.querySelector(".trip-workspace-candidates")!;
    expect(candidates.textContent).toContain("未採用"); expect(candidates.textContent).toContain("0円ではありません"); expect(candidates.textContent).toContain("旅行全体の評価ではありません");
    expect(candidates.closest(".trip-workspace-card")).toBeNull(); expect(f.ui.panel.textContent).toContain("EUR 120.00");
    expect(f.ui.panel.querySelector(".trip-party-control")?.textContent).toContain("大人"); expect(f.controller.current()).toEqual(before);
  });
  it("session change drops neither proposals nor selection; another Trip does not receive them", () => {
    const f = setup({ getCurrentTrip: multiCityTrip }); f.controller.focus("activity"); f.controller.propose("削除", [{ type: "remove", itemId: "activity" }]);
    f.controller.attach("two", { getCurrentTrip: () => createTrip("22222222-2222-4222-8222-222222222222", "別の旅", placesAt, [placeActivity("other")]) });
    f.controller.activateSession("two"); expect(f.ui.panel.textContent).not.toContain("変更案（まだ反映"); expect(f.controller.uiFocus()).toBeUndefined();
    f.controller.activateSession("one"); expect(f.ui.panel.textContent).toContain("変更案（まだ反映"); expect(f.controller.uiFocus()?.itemId).toBe("activity");
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
