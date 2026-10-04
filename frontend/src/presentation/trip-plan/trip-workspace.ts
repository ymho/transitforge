import { renderTripCosts } from "./trip-cost-view";
import type { TripWorkspaceController } from "../../usecases/trip-plan/trip-workspace-controller";
import type { ContextViewKind } from "../../domain/context-workspace";
import { proposeDayActivity } from "../../usecases/trip-plan/propose-day-activity";
import { proposeTripItemChange } from "@raiquora/trip/trip-item-proposal";
import { tripWorkspaceProjection, itemAssumptions } from "./trip-workspace-projection";
import { renderWorkspaceCard, refreshMoveTargets } from "./trip-workspace-card";
import { renderWorkspaceCandidates } from "./trip-workspace-candidates";
import { renderWorkspaceProposal } from "./trip-workspace-proposal";
import { element, control, option } from "./trip-workspace-elements";
import { travelIcon } from "../shared/travel-icon";
import { tripDateLabel } from "../../usecases/trip-plan/trip-header-presentation";
import { renderTripPartyControl } from "./trip-party-control";
import { renderTripTravelMode } from "./trip-travel-mode";
import type { InTripContextSnapshot } from "@raiquora/trip/in-trip-context";
import type { Trip } from "@raiquora/trip/trip";
import { canConfirmTrip } from "@raiquora/trip/trip-adoption";
import { renderPublicPlanPresentation } from "../concierge/public-plan-presentation-view";
import { previewPlanAdoption } from "../concierge/plan-adoption-view";
import type { AiGuidePanelElements } from "../concierge/ai-guide-panel";

/** DOM and navigation only. The supplied source owns the current server Trip. */
export function configureTripWorkspace(options: {
  app: HTMLElement; chat: HTMLElement; messages: HTMLElement; input: HTMLInputElement;
  controller: TripWorkspaceController;
  showContext(view: ContextViewKind): void; returnToConversation(): void; showMap(itemId?: string): void;
  loadInTripContext?(tripId: string): Promise<InTripContextSnapshot | undefined>;
  ask(prompt: string): void; nextItemId(): string;
  showTripList?(): void;
  onViewChange?(view: "chat" | "trip"): void;
  changeAdoption?(trip: Trip, action: "confirm" | "withdraw"): Promise<void>;
  changeItemDecision?(trip: Trip, item: Trip["items"][number], action: "confirm" | "withdraw"): Promise<void>;
  branchTrip?(trip: Trip, title: string): Promise<void>;
  conversationId?(): string;
  onPlanAdoption?: AiGuidePanelElements["onPlanAdoption"];
}) {
  const { controller, app } = options;
  const panel = element("section", "trip-workspace"); panel.id = "trip-workspace"; panel.hidden = true;
  panel.setAttribute("aria-label", "Trip V2の旅程"); panel.tabIndex = -1;
  const nav = element("nav", "trip-workspace-navigation"); nav.setAttribute("aria-label", "会話と旅程の切替"); nav.hidden = true;
  const status = element("p", "trip-workspace-status"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const report = (text: string) => { status.textContent = text; };
  const heading = element("header", "trip-workspace-heading"); const title = element("h1"); const summary = element("p", "trip-workspace-copy");
  const openTravelMode = control("旅行モードを開く", () => { void showTravelMode(); });
  const emblem = element("span", "trip-workspace-emblem"); emblem.innerHTML = travelIcon("trip"); emblem.setAttribute("aria-hidden", "true");
  const notice = element("p", "trip-workspace-notice");
  const openConsultation = control("この旅について相談", () => show("chat"));
  openConsultation.dataset.tripConsultation = "";
  let adoptionBusy = false, branchBusy = false;
  const adoption = control("この旅程で行く", () => {
    const trip = controller.current(); if (!trip || !options.changeAdoption) return;
    const action = trip.adoption && !trip.adoption.needsReconfirmation ? "withdraw" : "confirm";
    const message = action === "confirm" ? "この旅程を確定しますか？" : "確定を取り消して計画へ戻しますか？";
    if (!document.defaultView?.confirm(message)) return;
    adoptionBusy = true; adoption.disabled = true;
    void options.changeAdoption(trip, action).then(() => report(action === "confirm" ? "旅程を確定しました。" : "計画中へ戻しました。"))
      .catch(() => report("旅程の状態を変更できませんでした。最新の旅程を確認してください。")).finally(() => { adoptionBusy = false; adoption.disabled = false; });
  });
  const branch = control("この旅程を分岐", () => {
    const trip = controller.current(); if (!trip || !options.branchTrip) return;
    const value = document.defaultView?.prompt("分岐した旅程の名前", `${trip.title}（分岐）`)?.trim();
    if (!value) return;
    branchBusy = true; branch.disabled = true;
    void options.branchTrip(trip, value).catch(() => report("旅程を分岐できませんでした。最新の旅程を確認してください。"))
      .finally(() => { branchBusy = false; branch.disabled = false; });
  });
  const party = element("div", "trip-header-party"); let partyKey = "";
  const back = control("‹ 旅程一覧", () => options.showTripList?.()); back.hidden = !options.showTripList;
  const management = element("details", "trip-header-management"); management.append(element("summary", "", "旅程の操作"), openConsultation, adoption, branch, openTravelMode);
  heading.append(back, emblem, title, summary, party, notice, management);
  const retry = control("旅程を再読み込み", () => { void controller.source()?.retry?.(); });
  const costs = element("div"); let costKey = "", costTripId: string | undefined, costSessionVersion: number | undefined;
  const dayTabs = element("div", "trip-day-tabs"); dayTabs.setAttribute("role", "tablist"); dayTabs.setAttribute("aria-label", "旅程の日付");
  const days = element("div", "trip-workspace-days"), proposal = element("div"), candidates = element("div");
  const selectedDays = new Map<string, string>();
  const itinerary = element("section", "trip-detail-panel"), details = element("details", "trip-extra-details");
  itinerary.id = "trip-detail-itinerary";
  details.append(element("summary", "", "費用"), costs);
  const add = element("form", "trip-workspace-add"); add.hidden = true;
  let addContext: { tripId: string; revision: number; session: string; afterId?: string } | undefined; const addLabel = element("label", "", "追加する予定 "); const addTitle = element("input");
  addTitle.required = true; addTitle.maxLength = 200; addLabel.append(addTitle);
  const categoryLabel = element("label", "", "種類 "); const addCategory = element("select");
  for (const [value, label] of [["sightseeing", "観光"], ["food", "食事"], ["experience", "体験"], ["event", "イベント"], ["free-time", "自由時間"]] as const) {
    addCategory.append(option(label, value));
  }
  categoryLabel.append(addCategory);
  const placeLabel = element("label", "", "場所名（任意・手入力） "); const addPlace = element("input"); addPlace.maxLength = 200; placeLabel.append(addPlace);
  const dayLabel = element("label", "", "追加する日 "); const addDay = element("select"); addDay.append(option("日時未定", "unscheduled")); dayLabel.append(addDay);
  const kindLabel = element("label", "", "予定の種類 "), addKind = element("select");
  for (const [value, label] of [["activity", "立ち寄り・食事"], ["transport", "未選択の移動"], ["stay", "未選択の宿泊"]] as const) addKind.append(option(label, value));
  kindLabel.append(addKind);
  const submit = element("button", "", "追加案を確認"); submit.type = "submit";
  add.append(addLabel, categoryLabel, placeLabel, dayLabel, kindLabel, element("p", "trip-workspace-copy", "場所名は立ち寄り・食事の手入力にだけ使います。移動・宿泊は未選択の枠を作り、時刻・営業・予約は確認しません。"), submit);
  addKind.addEventListener("change", () => { categoryLabel.hidden = placeLabel.hidden = addKind.value !== "activity"; });
  add.addEventListener("submit", (event) => {
    event.preventDefault(); const trip = controller.current(); if (!trip) return;
    if (!addContext || trip.id !== addContext.tripId || trip.revision !== addContext.revision || controller.sessionId() !== addContext.session) { report("最新の旅程から追加し直してください。"); return; }
    try {
      const focusedId = addContext?.afterId ?? controller.uiFocus()?.itemId;
      const target = { itemId: options.nextItemId(), title: addTitle.value, dayKey: addDay.value,
        ...(focusedId && tripWorkspaceProjection(trip).dayEntries
          .find(([key]) => key === addDay.value)?.[1].some(({ sourceItemId }) => sourceItemId === focusedId) ? { afterId: focusedId } : {}) };
      controller.preview(addKind.value === "activity" ? proposeDayActivity(trip, { ...target,
        category: addCategory.value as "sightseeing" | "food" | "experience" | "event" | "free-time",
        ...(addPlace.value.trim() ? { placeName: addPlace.value } : {}) })
        : proposeTripItemChange(trip, { ...target, action: addKind.value === "transport" ? "add-transport" : "add-stay" }));
      report("追加案を表示しました。現在の旅程はまだ変更していません。");
    } catch { report("追加する予定の名称と対象を確認してください。"); }
  });
  const consult = control("相談して追加", () => { if (addContext?.afterId) controller.focus(addContext.afterId); chat(addContext?.afterId ? "この予定の後に追加する予定を相談したい" : "旅程に追加する予定を相談したい"); });
  add.append(consult, control("取消", () => { add.hidden = true; addContext = undefined; }));
  const startAdd = (trip: Trip, dayKey: string, afterId?: string, anchor?: HTMLElement) => {
    addContext = { tripId: trip.id, revision: trip.revision, session: controller.sessionId(), ...(afterId ? { afterId } : {}) };
    addDay.value = dayKey; add.hidden = false; if (anchor) anchor.after(add); else days.after(add); addTitle.focus();
  };
  const addFirst = control("＋ 予定を追加", () => { const trip = controller.current(); if (trip) startAdd(trip, addDay.value); });
  const planDraft = element("section", "trip-workspace-plan-draft"); planDraft.hidden = true; let planKey = "";
  planDraft.addEventListener("raiquora:preview-plan-adoption", event => {
    if (!options.onPlanAdoption || !options.conversationId) return;
    const session = controller.sessionId(), trip = controller.current(), conversationId = options.conversationId();
    previewPlanAdoption(event, { conversationId, adopt: options.onPlanAdoption,
      isCurrent: () => controller.sessionId() === session && options.conversationId?.() === conversationId &&
        controller.current()?.id === trip?.id && controller.current()?.revision === trip?.revision });
  });
  itinerary.append(planDraft, dayTabs, days, addFirst, add, candidates);
  const detail = element("div", "trip-detail-view"); detail.append(heading, status, retry, itinerary, proposal, candidates, details);
  const travelMode = element("div"); travelMode.hidden = true;
  panel.append(detail, travelMode);
  app.append(panel, nav);
  const views = new Map<string, { scroll: number; chatScroll: number; view: "chat" | "trip"; focus?: HTMLElement }>();
  const collapsed = new Map<string, boolean>();
  const cards = new Map<string, { node: HTMLElement; key: string }>();
  const groups = new Map<string, HTMLElement>();
  let activeSession = controller.sessionId(), previousTripId: string | undefined, proposalKey = "", candidateKey = "";
  let travelGeneration = 0, detailScroll = 0, travelTripKey = "";
  const viewState = () => {
    if (!views.has(activeSession)) views.set(activeSession, { scroll: 0, chatScroll: 0, view: "chat" });
    return views.get(activeSession)!;
  };
  const show = (view: "chat" | "trip") => {
    const state = viewState();
    if (state.view === "trip") state.scroll = panel.scrollTop;
    if (view === "trip" && state.view !== "trip") {
      state.chatScroll = options.messages.scrollTop;
      state.focus = options.chat.contains(document.activeElement) ? document.activeElement as HTMLElement : undefined;
    }
    state.view = view; options.returnToConversation(); options.showContext(view === "trip" ? "trip-plan" : "map");
    app.dataset.tripWorkspaceView = view;
    options.onViewChange?.(view);
    for (const button of [chatButton, tripButton]) button.setAttribute("aria-pressed", String(button === (view === "trip" ? tripButton : chatButton)));
    panel.scrollTop = state.scroll;
    if (view === "chat") { options.messages.scrollTop = state.chatScroll; (state.focus?.isConnected ? state.focus : options.input).focus({ preventScroll: true }); }
    else panel.focus({ preventScroll: true });
  };
  const chat = (prompt: string) => { show("chat"); options.ask(prompt); };
  const chatButton = control("会話", () => show("chat")), tripButton = control("旅程", () => show("trip"));
  chatButton.setAttribute("aria-controls", options.chat.id); tripButton.setAttribute("aria-controls", panel.id);
  nav.append(chatButton, tripButton, control("地図", options.showMap));

  async function showTravelMode() {
    const trip = controller.current(); if (!trip) return;
    const generation = ++travelGeneration, session = controller.sessionId(), revision = trip.revision;
    detailScroll = panel.scrollTop; travelTripKey = `${trip.id}:${trip.revision}`; detail.hidden = true; travelMode.hidden = false;
    travelMode.replaceChildren(element("p", "", "旅行中の情報を確認しています。")); panel.scrollTop = 0;
    let snapshot: InTripContextSnapshot | undefined, unavailable = false;
    if (trip.lifecycleState === "in_trip" && options.loadInTripContext) {
      try { snapshot = await options.loadInTripContext(trip.id); } catch { unavailable = true; }
    }
    const latest = controller.current();
    if (generation !== travelGeneration || controller.sessionId() !== session || !latest || latest.id !== trip.id || latest.revision !== revision) return;
    travelMode.replaceChildren(renderTripTravelMode({ trip: latest, now: new Date(), snapshot, unavailable,
      back: () => { travelGeneration++; travelTripKey = ""; travelMode.hidden = true; detail.hidden = false; panel.scrollTop = detailScroll; },
      ask: chat, focus: (itemId) => { controller.focus(itemId); options.showMap(itemId); } }));
  }

  const render = () => {
    if (activeSession !== controller.sessionId()) {
      viewState().scroll = panel.scrollTop; viewState().chatScroll = options.messages.scrollTop;
      activeSession = controller.sessionId(); previousTripId = undefined; report("");
      travelGeneration++; travelTripKey = ""; travelMode.hidden = true; detail.hidden = false;
      costs.replaceChildren(); costKey = ""; costTripId = undefined;
      partyKey = ""; add.hidden = true; addContext = undefined;
    }
    const nextCostSession = controller.source()?.sessionVersion?.();
    if (nextCostSession !== costSessionVersion) { costs.replaceChildren(); costKey = ""; costTripId = undefined; costSessionVersion = nextCostSession; }
    const trip = controller.current();
    const plan = controller.plan(), nextPlanKey = JSON.stringify([controller.sessionId(), plan]);
    if (planKey !== nextPlanKey) {
      planKey = nextPlanKey; planDraft.replaceChildren(); planDraft.hidden = !plan;
      if (plan) planDraft.append(element("h2", "", "未保存の旅程案"), element("p", "", "内容を確認して「この案を採用する」から旅程へ保存できます。"),
        renderPublicPlanPresentation(plan, { idPrefix: "workspace-", detailedResearch: false }));
    }
    if (trip && travelTripKey && travelTripKey !== `${trip.id}:${trip.revision}`) { travelGeneration++; travelTripKey = ""; travelMode.hidden = true; detail.hidden = false; }
    panel.hidden = nav.hidden = !controller.blocksLegacy();
    if (!controller.blocksLegacy()) { delete app.dataset.tripWorkspace; delete app.dataset.tripWorkspaceView; return; }
    app.dataset.tripWorkspace = "v2"; app.dataset.tripWorkspaceView = viewState().view;
    chatButton.setAttribute("aria-pressed", String(viewState().view === "chat"));
    tripButton.setAttribute("aria-pressed", String(viewState().view === "trip"));
    const server = true;
    notice.textContent = controller.source()?.getRole?.() === "viewer" ? "共有された旅程です（閲覧専用）。会話履歴・予約の個人情報は共有されません。"
      : controller.source()?.confirmationPersistence === "server" ? "変更案を確認するとサーバに保存します。競合した場合は最新の旅程で確認し直してください。"
      : "サーバの旅程を参照しています。変更案は確認用プレビューで、まだ保存できません。";
    notice.hidden = controller.source()?.getRole?.() !== "viewer";
    retry.hidden = controller.loadState() !== "unavailable" || !controller.source()?.retry;
    retry.disabled = controller.loadState() === "loading";
    addFirst.hidden = !trip || controller.source()?.getRole?.() === "viewer";
    openTravelMode.hidden = openConsultation.hidden = adoption.hidden = branch.hidden = !trip;
    if (!trip) {
      title.textContent = "旅程"; summary.textContent = "";
      report(controller.loadState() === "loading" ? "サーバから旅程を読み込んでいます。" : "旅程を取得できません。認証と接続、参照先の状態を確認して再試行してください。端末の旧旅程へは切り替えていません。");
      const costEditor = costs.querySelector(".trip-cost-editor");
      costs.replaceChildren(...(costEditor ? [costEditor] : [])); costKey = "";
      days.replaceChildren(); proposal.replaceChildren(); candidates.replaceChildren();
      dayTabs.replaceChildren();
      party.replaceChildren(); partyKey = "";
      cards.clear(); groups.clear(); previousTripId = undefined; proposalKey = candidateKey = "";
      return;
    }
    if (server) report("");
    if (previousTripId !== trip.id) {
      cards.clear(); groups.clear(); days.replaceChildren(); proposalKey = candidateKey = "";
      add.hidden = true; addContext = undefined; partyKey = "";
      previousTripId = trip.id; panel.scrollTop = viewState().scroll;
    }
    const view = tripWorkspaceProjection(trip), scroll = panel.scrollTop;
    const chosenDay = addDay.value;
    addDay.replaceChildren(option("日時未定", "unscheduled"), ...view.dayEntries.filter(([key]) => key !== "unscheduled")
      .map(([key, , label]) => option(label, key)));
    addDay.value = [...addDay.options].some((entry) => entry.value === chosenDay) ? chosenDay : "unscheduled";
    const evaluation = controller.feasibility()!;
    const nextCostKey = JSON.stringify([trip.id, trip.revision, trip.costs, controller.canConfirm()]);
    if (costKey !== nextCostKey) {
      const editor = costTripId === trip.id ? costs.querySelector(".trip-cost-editor") : null;
      costKey = nextCostKey; costTripId = trip.id; costs.replaceChildren(renderTripCosts(trip, controller, chat, report));
      if (editor) { costs.append(editor); report("旅程が更新されました。費用の入力は残しています。取消後、最新の費用から編集し直してください。"); }
    }
    title.textContent = view.title;
    const role = controller.source()?.getRole?.(), personalOwner = role === undefined || role === "owner";
    adoption.hidden = !options.changeAdoption || !personalOwner || ["cancelled", "completed"].includes(trip.lifecycleState);
    adoption.textContent = trip.adoption && !trip.adoption.needsReconfirmation ? "計画へ戻す"
      : trip.adoption?.needsReconfirmation ? "変更後の旅程を再確認" : "この旅程で行く";
    adoption.disabled = adoptionBusy || (!trip.adoption || trip.adoption.needsReconfirmation ? !canConfirmTrip(trip) : false);
    branch.hidden = !options.branchTrip || !personalOwner;
    branch.disabled = branchBusy;
    summary.textContent = tripDateLabel(trip);
    const nextPartyKey = JSON.stringify([trip.id, trip.revision, trip.request.party]);
    if (partyKey !== nextPartyKey) { partyKey = nextPartyKey; party.replaceChildren(renderTripPartyControl(trip, controller, report)); }
    const ids = new Set<string>(), dates = new Set<string>();
    const dayLabels = new Map<string, string>();
    for (const [date, entries, label] of view.dayEntries) {
      dates.add(date); dayLabels.set(date, label);
      let group = groups.get(date);
      if (!group) { group = element("section", "trip-workspace-day"); group.append(element("h2", "", label)); groups.set(date, group); }
      if (days.children[[...dates].length - 1] !== group) days.insertBefore(group, days.children[[...dates].length - 1] ?? null);
      entries.forEach((entry, index) => {
        const { item, entryKey } = entry;
        ids.add(entryKey);
        const key = JSON.stringify([item, entry.role, itemAssumptions(trip, item.id), controller.reservations()?.filter((r) => r.itineraryItemId === item.id),
          evaluation.issues.filter((i) => i.itemIds.includes(item.id)), personalOwner && !!options.changeItemDecision]);
        const collapseKey = `${activeSession}:${trip.id}:${entryKey}`;
        let card = cards.get(entryKey);
        if (card?.key !== key) {
          const node = renderWorkspaceCard(trip, item, controller, { entry, addAfter: () => startAdd(trip, date, item.id, cards.get(entryKey)?.node), collapsed: collapsed.get(collapseKey) ?? true,
            collapse: (value) => collapsed.set(collapseKey, value), chat, report,
            ...(personalOwner && options.changeItemDecision ? { changeItemDecision: options.changeItemDecision } : {}) }, evaluation.issues.filter((i) => i.itemIds.includes(item.id)));
          if (card) card.node.replaceWith(node);
          card = { node, key }; cards.set(entryKey, card);
        }
        card.node.classList.toggle("is-focused", controller.uiFocus()?.itemId === item.id);
        refreshMoveTargets(card.node, trip, item.id);
        card.node.querySelector(".trip-workspace-item-focus")?.setAttribute("aria-pressed", String(controller.uiFocus()?.itemId === item.id));
        if (group!.children[index + 1] !== card.node) group!.insertBefore(card.node, group!.children[index + 1] ?? null);
      });
    }
    if (!add.hidden && addContext?.afterId) {
      const target = view.dayEntries.find(([key, entries]) => entries.some(e => e.sourceItemId === addContext!.afterId) && key === addDay.value)?.[1].find(e => e.sourceItemId === addContext!.afterId);
      if (target) cards.get(target.entryKey)?.node.after(add);
    }
    for (const [id, card] of cards) if (!ids.has(id)) { card.node.remove(); cards.delete(id); }
    for (const [date, group] of groups) if (!dates.has(date)) { group.remove(); groups.delete(date); }
    const availableDays = [...dates];
    let selectedDay = selectedDays.get(trip.id);
    if (!selectedDay || !dates.has(selectedDay)) { selectedDay = availableDays[0]; if (selectedDay) selectedDays.set(trip.id, selectedDay); }
    const applySelectedDay = (next: string, focus = false) => {
      selectedDays.set(trip.id, next);
      for (const [date, group] of groups) group.hidden = date !== next;
      for (const button of dayTabs.querySelectorAll<HTMLButtonElement>('[role="tab"]')) {
        const chosen = button.dataset.day === next; button.setAttribute("aria-selected", String(chosen)); button.tabIndex = chosen ? 0 : -1;
      }
      if (focus) dayTabs.querySelector<HTMLButtonElement>(`[data-day="${CSS.escape(next)}"]`)?.focus();
    };
    dayTabs.hidden = availableDays.length < 2; dayTabs.replaceChildren();
    availableDays.forEach((date, index) => {
      const button = control(dayLabels.get(date) ?? date, () => applySelectedDay(date)); button.setAttribute("role", "tab"); button.dataset.day = date;
      button.setAttribute("aria-controls", `trip-day-${index}`); groups.get(date)!.id = `trip-day-${index}`; groups.get(date)!.setAttribute("role", "tabpanel");
      button.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault(); applySelectedDay(availableDays[(index + (event.key === "ArrowRight" ? 1 : -1) + availableDays.length) % availableDays.length]!, true);
      }); dayTabs.append(button);
    });
    if (selectedDay) applySelectedDay(selectedDay);
    const shown = controller.proposal(), nextKey = JSON.stringify([trip, shown, controller.reservations(), evaluation.issues]);
    if (proposalKey !== nextKey) {
      proposalKey = nextKey; proposal.replaceChildren();
      if (shown) {
        try { proposal.append(renderWorkspaceProposal(trip, shown, controller, report)); report("変更案を表示しました。現在の旅程と比較してください。"); }
        catch { report("変更案と現在の旅程が一致しません。提案を確認し直してください。"); }
      }
    }
    const nextCandidates = JSON.stringify([controller.candidates(), trip.items.map((i) => [i.id, i.title]), controller.uiFocus()]);
    if (candidateKey !== nextCandidates) { candidateKey = nextCandidates; candidates.replaceChildren(renderWorkspaceCandidates(controller, report)); }
    panel.scrollTop = scroll;
  };
  const canLeave = () => {
    const editor = costs.querySelector(".trip-cost-editor");
    if (!editor || document.defaultView?.confirm("編集中の費用を破棄して移動しますか？")) { editor?.remove(); return true; }
    return false;
  };
  const beforeUnload = (event: BeforeUnloadEvent) => { if (costs.querySelector(".trip-cost-editor")) { event.preventDefault(); event.returnValue = ""; } };
  document.defaultView?.addEventListener("beforeunload", beforeUnload);
  const unsubscribe = controller.subscribe(render); render();
  return { panel, nav, render, show, report, canLeave, openTravelMode: showTravelMode,
    showPlan() { show("trip"); },
    destroy() { document.defaultView?.removeEventListener("beforeunload", beforeUnload); unsubscribe(); panel.remove(); nav.remove(); delete app.dataset.tripWorkspace; delete app.dataset.tripWorkspaceView; } };
}
