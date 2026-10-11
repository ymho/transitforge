import { notifySaved } from "../shared/save-notification";
import { confirmAction, requestText } from "../shared/app-dialog";
import { openTripEditor } from "./trip-editor-dialog";
import { openTripOrderEditor } from "./trip-order-editor";
import { iconMarkup, setLoadingStatus } from "../shared/primitives";
import type { TripWorkspaceController } from "../../usecases/trip-plan/trip-workspace-controller";
import type { ContextViewKind } from "../../domain/context-workspace";
import { tripWorkspaceProjection, itemAssumptions } from "./trip-workspace-projection";
import { renderWorkspaceCard } from "./trip-workspace-card";
import { tripAddConsultation } from "./trip-add-consultation";
import { renderWorkspaceProposal } from "./trip-workspace-proposal";
import { element, control } from "./trip-workspace-elements";
import { tripCoverImage } from "../shared/trip-cover";
import { travelIcon } from "../shared/travel-icon";
import { tripDateLabel } from "../../usecases/trip-plan/trip-header-presentation";
import { renderTripPartyControl } from "./trip-party-control";
import { renderTripTravelMode } from "./trip-travel-mode";
import type { InTripContextSnapshot } from "@raiquora/trip/in-trip-context";
import type { Trip } from "@raiquora/trip/trip";
import { unmarkedBookingItems } from "@raiquora/trip/trip";
import { canConfirmTrip } from "@raiquora/trip/trip-adoption";
import type { AiGuidePanelElements } from "../concierge/ai-guide-panel";

/** DOM and navigation only. The supplied source owns the current server Trip. */
export function configureTripWorkspace(options: {
  app: HTMLElement; chat: HTMLElement; messages: HTMLElement; input: HTMLInputElement;
  controller: TripWorkspaceController;
  showContext(view: ContextViewKind): void; returnToConversation(): void; showMap(itemId?: string): void;
  loadInTripContext?(tripId: string): Promise<InTripContextSnapshot | undefined>;
  ask(prompt: string): void; nextItemId(): string;
  showTripList?(): void;
  folioKind?(trip: Trip): "official" | "shared" | undefined;
  onViewChange?(view: "chat" | "trip"): void;
  openSharing?(): void;
  changeAdoption?(trip: Trip, action: "confirm" | "withdraw"): Promise<void>;
  changeItemDecision?(trip: Trip, item: Trip["items"][number], action: "confirm" | "withdraw"): Promise<void>;
  refreshWeather?(trip: Trip, itemId: string): Promise<void>;
  renameTitle?(trip: Trip, title: string): Promise<void>;
  branchTrip?(trip: Trip, title: string): Promise<void>;
  conversationId?(): string;
  onPlanAdoption?: AiGuidePanelElements["onPlanAdoption"];
}) {
  const { controller, app } = options;
  const panel = element("section", "trip-workspace"); panel.id = "trip-workspace"; panel.hidden = true;
  panel.setAttribute("aria-label", "旅程"); panel.tabIndex = -1;
  const nav = element("nav", "trip-workspace-navigation"); nav.setAttribute("aria-label", "会話と旅程の切替"); nav.hidden = true;
  const status = element("p", "trip-workspace-status"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const report = (text: string) => { setLoadingStatus(status, text, controller.loadState() === "loading"); };
  const heading = element("header", "trip-workspace-heading"); const title = element("h1"); const summary = element("p", "trip-workspace-copy");
  const emblem = element("span", "trip-workspace-emblem"); emblem.innerHTML = travelIcon("trip"); emblem.setAttribute("aria-hidden", "true");
  const notice = element("p", "trip-workspace-notice");
  let adoptionBusy = false;
  const adoption = control("この旅程で行く", async () => {
    const trip = controller.current(); if (!trip || !options.changeAdoption) return;
    const action = trip.adoption && !trip.adoption.needsReconfirmation ? "withdraw" : "confirm";
    const unmarked = unmarkedBookingItems(trip, controller.reservations());
    const message = action === "confirm" ? unmarked.length ? `予約済・予約不要が未確認の予定があります：${unmarked.map(item => item.title).join("、")}。このまま旅程を確定しますか？` : "この旅程を確定しますか？" : "確定を取り消して計画へ戻しますか？";
    if (!await confirmAction(document, message)) return;
    if (controller.current()?.id !== trip.id || controller.current()?.revision !== trip.revision || controller.source()?.getRole?.() === "viewer") return;
    adoptionBusy = true; adoption.disabled = true;
    void options.changeAdoption(trip, action).then(() => notifySaved(document, action === "confirm" ? "旅程を確定しました。" : "計画中へ戻しました。"))
      .catch(() => report("旅程の状態を変更できませんでした。最新の旅程を確認してください。")).finally(() => { adoptionBusy = false; adoption.disabled = false; });
  });
  const party = element("div", "trip-header-party"); let partyKey = "";
  const back = control("‹ 旅程一覧", () => options.showTripList?.()); back.hidden = !options.showTripList;
  const share = control("共有", () => options.openSharing?.()); share.hidden = !options.openSharing;
  const adoptionHelp = element("p", "trip-workspace-notice");
  adoption.classList.add("trip-confirm-button");
  const identity = element("div", "trip-header-identity");
  const folioBadge = element("p", "trip-header-eyebrow"); folioBadge.hidden = true;
  let titleBusy = false;
  const editTitle = control("", async () => {
    const trip = controller.current();
    if (!trip || titleBusy || !options.renameTitle || controller.source()?.getRole?.() === "viewer") return;
    const nextTitle = (await requestText(document, "旅程の名前", trip.title))?.trim();
    if (!nextTitle || nextTitle === trip.title || controller.current()?.id !== trip.id || controller.current()?.revision !== trip.revision || controller.source()?.getRole?.() === "viewer") return;
    titleBusy = true; editTitle.disabled = true;
    void options.renameTitle(trip, nextTitle).then(() => { if (controller.current()?.id === trip.id) notifySaved(document, "名称を変更しました。"); })
      .catch(() => { if (controller.current()?.id === trip.id) report("名称を変更できませんでした。最新の旅程を確認してください。"); })
      .finally(() => { titleBusy = false; editTitle.disabled = false; });
  });
  editTitle.className = "trip-title-edit"; editTitle.innerHTML = iconMarkup("pencil");
  editTitle.setAttribute("aria-label", "旅程の名称を編集"); editTitle.title = "旅程の名称を編集";
  const titleRow = element("div", "trip-header-title-row"); titleRow.append(title, editTitle);
  identity.append(folioBadge, titleRow, party);
  const headerActions = element("div", "trip-header-actions"); headerActions.append(adoption, share);
  const cover = element("div", "trip-header-cover"); const coverImage = element("img");
  coverImage.alt = ""; coverImage.setAttribute("aria-hidden", "true");
  cover.append(coverImage, element("small", "trip-cover-caption", "旅のイメージ"));
  const coverContent = element("div", "trip-header-content"); coverContent.append(identity, headerActions);
  const hero = element("div", "trip-header-hero"); hero.append(cover, coverContent);
  heading.append(back, emblem, hero, notice, adoptionHelp);
  const retry = control("旅程を再読み込み", () => { void controller.source()?.retry?.(); });
  let metadataPending: Promise<void> = Promise.resolve();
  const saveMetadata = (build: (current: Trip) => import("@raiquora/trip/trip").TripUpdateProposal): Promise<void> => {
    const session = controller.sessionId(), source = controller.source(), tripId = controller.current()?.id;
    const next = metadataPending.catch(() => {}).then(async () => {
      const current = controller.current();
      if (!current || current.id !== tripId || controller.sessionId() !== session || controller.source() !== source || !controller.canConfirm()) throw new Error("旅程が更新されました");
      await controller.applyConfirmed(build(current));
    });
    metadataPending = next; return next;
  };
  const memoDrafts = new Map<string, { value: string; base?: string }>();
  const pendingCostEditors = new Map<string, { tripId: string; node: Element }>();
  let costSessionVersion = controller.source()?.sessionVersion?.();
  const dayTabs = element("div", "trip-day-tabs"); dayTabs.setAttribute("role", "tablist"); dayTabs.setAttribute("aria-label", "旅程の日付");
  const days = element("div", "trip-workspace-days"), proposal = element("div");
  const selectedDays = new Map<string, string>();
  const itinerary = element("section", "trip-detail-panel");
  itinerary.id = "trip-detail-itinerary";
  const add = element("form", "trip-workspace-add"); add.hidden = true;
  let addContext: { tripId: string; revision: number; session: string; dayKey: string; afterId?: string; beforeId?: string } | undefined;
  let addAnchor: HTMLElement | undefined;
  const addLabel = element("label", "", "どんな予定を追加したい？"), addTitle = element("textarea");
  addTitle.required = true; addTitle.maxLength = 2000; addTitle.rows = 3;
  addTitle.placeholder = "湖畔で休憩したい、出雲大社の近くで夕食を食べたい など";
  addLabel.append(addTitle);
  const closeAdd = () => {
    add.hidden = true;
    const dialog = add.closest("dialog"); if (dialog?.open) dialog.close();
    addContext = undefined;
  };
  add.addEventListener("submit", event => {
    event.preventDefault(); const trip = controller.current();
    if (!trip || controller.source()?.getRole?.() === "viewer" || !addContext || trip.id !== addContext.tripId || trip.revision !== addContext.revision || controller.sessionId() !== addContext.session) {
      report("最新の旅程から追加し直してください。"); return;
    }
    if (!addTitle.value.trim()) { addTitle.focus(); return; }
    const context = tripAddConsultation(trip, addContext.dayKey, addContext.afterId, addTitle.value,
      { beforeId: addContext.beforeId });
    closeAdd(); controller.focus(context.itemId); chat(context.prompt);
  });
  const submit = element("button", "trip-primary-action", "相談して追加"); submit.type = "submit";
  const addActions = element("div", "trip-form-actions");
  addActions.append(control("取消", () => { closeAdd(); (addAnchor?.isConnected ? addAnchor : panel).focus(); }), submit);
  add.append(addLabel, addActions);
  const startAdd = (trip: Trip, dayKey: string, afterId?: string, beforeId?: string, anchor?: HTMLElement) => {
    addContext = { tripId: trip.id, revision: trip.revision, session: controller.sessionId(), dayKey, afterId, beforeId };
    addAnchor = anchor; add.reset(); openTripEditor(add, "予定を追加"); addTitle.focus();
  };
  const addFirst = control("＋ 予定を追加", () => { const trip = controller.current(); if (trip) startAdd(trip, "unscheduled", undefined, undefined, addFirst); });
  const planDraft = element("section", "trip-workspace-plan-draft"); planDraft.hidden = true; let planKey = "";
  summary.classList.add("trip-itinerary-dates");
  const reorder = control("並び替え", () => openTripOrderEditor(controller, report));
  reorder.className = "trip-order-open";
  const itineraryHeading = element("div", "trip-itinerary-heading"); itineraryHeading.append(summary, reorder);
  itinerary.append(planDraft, itineraryHeading, dayTabs, days, addFirst, add);
  const detail = element("div", "trip-detail-view"); detail.append(heading, status, retry, itinerary, proposal);
  const travelMode = element("div"); travelMode.hidden = true;
  panel.append(detail, travelMode);
  app.append(panel, nav);
  const views = new Map<string, { scroll: number; chatScroll: number; view: "chat" | "trip"; focus?: HTMLElement }>();
  const collapsed = new Map<string, boolean>();
  const cards = new Map<string, { node: HTMLElement; key: string }>();
  const groups = new Map<string, HTMLElement>();
  let activeSession = controller.sessionId(), previousTripId: string | undefined, proposalKey = "";
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
    const waiting = element("p"); waiting.setAttribute("role", "status"); setLoadingStatus(waiting, "旅行中の情報を確認しています。", true);
    travelMode.replaceChildren(waiting); panel.scrollTop = 0;
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
    const nextCostSession = controller.source()?.sessionVersion?.();
    if (nextCostSession !== costSessionVersion) {
      memoDrafts.clear(); pendingCostEditors.clear(); panel.querySelectorAll(".trip-cost-editor").forEach(editor => editor.remove());
      costSessionVersion = nextCostSession;
    }
    if (activeSession !== controller.sessionId()) {
      viewState().scroll = panel.scrollTop; viewState().chatScroll = options.messages.scrollTop;
      memoDrafts.clear(); pendingCostEditors.clear(); panel.querySelectorAll(".trip-cost-editor").forEach(editor => editor.remove());
      activeSession = controller.sessionId(); previousTripId = undefined; report("");
      travelGeneration++; travelTripKey = ""; travelMode.hidden = true; detail.hidden = false;
      partyKey = ""; add.hidden = true; addContext = undefined;
    }
    const trip = controller.current();
    const hasPending = !!controller.plan() || controller.candidates().length > 0;
    const nextPlanKey = JSON.stringify([controller.sessionId(), hasPending]);
    if (planKey !== nextPlanKey) {
      planKey = nextPlanKey; planDraft.replaceChildren(); planDraft.hidden = !hasPending;
      if (hasPending) {
        const link = control("相談で確認", () => show("chat")); link.className = "trip-pending-plan-link";
        planDraft.append(element("span", "", "未採用の提案があります"), link);
      }
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
    addFirst.hidden = !trip || trip.items.length > 0 || controller.source()?.getRole?.() === "viewer";
    reorder.hidden = !trip || trip.items.length < 2 || controller.source()?.getRole?.() === "viewer";
    adoption.hidden = !trip;
    if (!trip) {
      share.hidden = true; adoptionHelp.textContent = "";
      title.textContent = "旅程"; summary.textContent = "";
      report(controller.loadState() === "loading" ? "サーバから旅程を読み込んでいます。" : "旅程を取得できません。認証と接続、参照先の状態を確認して再試行してください。端末の旧旅程へは切り替えていません。");
      if (previousTripId) for (const [entryKey, card] of cards) {
        const editor = card.node.querySelector(".trip-cost-editor");
        if (editor) pendingCostEditors.set(entryKey, { tripId: previousTripId, node: editor });
      }
      days.replaceChildren(); proposal.replaceChildren();
      dayTabs.replaceChildren();
      party.replaceChildren(); partyKey = "";
      cards.clear(); groups.clear(); previousTripId = undefined; proposalKey = "";
      return;
    }
    if (server) report("");
    if (previousTripId !== trip.id) {
      cards.clear(); groups.clear(); days.replaceChildren(); proposalKey = "";
      add.hidden = true; addContext = undefined; partyKey = "";
      previousTripId = trip.id; panel.scrollTop = viewState().scroll;
    }
    const view = tripWorkspaceProjection(trip), scroll = panel.scrollTop;
    const evaluation = controller.feasibility()!;
    title.textContent = view.title;
    editTitle.hidden = !options.renameTitle || controller.source()?.getRole?.() === "viewer";
    editTitle.disabled = titleBusy;
    const coverPath = tripCoverImage(trip.id); if (coverImage.getAttribute("src") !== coverPath) coverImage.src = coverPath;
    const role = controller.source()?.getRole?.(), personalOwner = role === undefined || role === "owner";
    adoption.hidden = !options.changeAdoption || !personalOwner || ["cancelled", "completed"].includes(trip.lifecycleState);
    adoption.textContent = trip.adoption && !trip.adoption.needsReconfirmation ? "計画へ戻す"
      : trip.adoption?.needsReconfirmation ? "変更後の旅程を再確認" : "旅程を確定";
    adoption.disabled = adoptionBusy || (!trip.adoption || trip.adoption.needsReconfirmation ? !canConfirmTrip(trip) : false);
    share.hidden = !options.openSharing;
    adoptionHelp.textContent = adoption.hidden || !adoption.disabled || adoptionBusy ? "" : !trip.items.length ? "予定を追加すると確定できます。" : "すべての予定に日程を設定すると確定できます。";
    adoptionHelp.hidden = !adoptionHelp.textContent;
    const labels = [notice.textContent ?? "", role === "viewer" ? "" : role === "editor" ? "共有された旅程です（共同編集）。" : "", trip.officialOrigin ? `公式しおりから作成（第${trip.officialOrigin.version}版）` : ""].filter(Boolean);
    notice.textContent = labels.join(" "); notice.hidden = role !== "viewer" && role !== "editor" && !trip.officialOrigin;
    summary.textContent = tripDateLabel(trip);
    const folioKind = options.folioKind?.(trip) ?? (["editor", "viewer"].includes(controller.source()?.getRole?.() ?? "") ? "shared" : undefined);
    folioBadge.textContent = folioKind === "official" ? "公式しおり" : folioKind === "shared" ? "共有しおり" : ""; folioBadge.hidden = !folioKind;
    const nextPartyKey = JSON.stringify([trip.id, trip.revision, trip.request.party]);
    if (partyKey !== nextPartyKey) { partyKey = nextPartyKey; party.replaceChildren(renderTripPartyControl(trip, controller, report)); }
    const ids = new Set<string>(), dates = new Set<string>();
    const dayLabels = new Map<string, string>();
    for (const [date, entries, label] of view.timelineDays) {
      dates.add(date); dayLabels.set(date, label);
      let group = groups.get(date);
      if (!group) { group = element("section", "trip-workspace-day"); groups.set(date, group); }
      group.setAttribute("aria-label", calendarDayLabel(label));
      if (days.children[[...dates].length - 1] !== group) days.insertBefore(group, days.children[[...dates].length - 1] ?? null);
      group.querySelectorAll(".trip-timeline-add").forEach(node => node.remove());
      let childIndex = 0;
      const addGap = (dayKey: string, afterId?: string, beforeId?: string) => {
        if (controller.source()?.getRole?.() === "viewer") return;
        const button = control("＋ 予定を追加", () => startAdd(trip, dayKey, afterId, beforeId, button));
        button.classList.add("trip-timeline-add");
        button.dataset.dayKey = dayKey;
        if (afterId) button.dataset.afterId = afterId;
        if (beforeId) button.dataset.beforeId = beforeId;
        group!.insertBefore(button, group!.children[childIndex++] ?? null);
      };
      const firstEntry = entries[0];
      if (firstEntry) addGap(firstEntry.sourceDayKey, undefined, firstEntry.sourceItemId);
      entries.forEach((entry, index) => {
        const { item, entryKey } = entry;
        ids.add(entryKey);
        const key = JSON.stringify([item, trip.weather?.find(value => value.itemId === item.id), trip.costs?.lines, controller.canConfirm(), entry.role, itemAssumptions(trip, item.id), controller.reservations()?.filter((r) => r.itineraryItemId === item.id),
          evaluation.issues.filter((i) => i.itemIds.includes(item.id)), personalOwner && !!options.changeItemDecision]);
        const collapseKey = `${activeSession}:${trip.id}:${entryKey}`;
        let card = cards.get(entryKey);
        if (card?.key !== key) {
          const node = renderWorkspaceCard(trip, item, controller, { entry, collapsed: collapsed.get(collapseKey) ?? true,
            collapse: (value) => collapsed.set(collapseKey, value), chat, report, memoDrafts, saveMetadata,
            ...(role !== "viewer" && options.refreshWeather ? { refreshWeather: options.refreshWeather } : {}),
            ...(personalOwner && options.changeItemDecision ? { changeItemDecision: options.changeItemDecision } : {}) }, evaluation.issues.filter((i) => i.itemIds.includes(item.id)));
          const pending = pendingCostEditors.get(entryKey);
          if (pending?.tripId === trip.id && controller.canConfirm()) node.querySelector(".trip-item-cost")?.append(pending.node);
          pendingCostEditors.delete(entryKey);
          if (card) {
            const editor = card.node.querySelector(".trip-cost-editor");
            if (editor && controller.canConfirm()) node.querySelector(".trip-item-cost")?.append(editor);
            card.node.replaceWith(node);
          }
          card = { node, key }; cards.set(entryKey, card);
        }
        card.node.classList.toggle("is-focused", controller.uiFocus()?.itemId === item.id);
        card.node.querySelector(".trip-workspace-item-focus")?.setAttribute("aria-pressed", String(controller.uiFocus()?.itemId === item.id));
        if (group!.children[childIndex] !== card.node) group!.insertBefore(card.node, group!.children[childIndex] ?? null);
        childIndex++;
        addGap(entry.sourceDayKey, entry.sourceItemId, entries[index + 1]?.sourceItemId);
      });
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
      const activeTab = dayTabs.querySelector<HTMLButtonElement>(`[data-day="${CSS.escape(next)}"]`);
      if (focus) { activeTab?.focus(); activeTab?.scrollIntoView({ block: "nearest", inline: "nearest" }); }
    };
    dayTabs.hidden = availableDays.length < 2; dayTabs.replaceChildren();
    availableDays.forEach((date, index) => {
      const dayLabel = dayLabels.get(date) ?? date;
      const button = control(calendarDayLabel(dayLabel), () => applySelectedDay(date));
      button.setAttribute("aria-label", dayLabel); button.setAttribute("role", "tab"); button.dataset.day = date;
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
    panel.scrollTop = scroll;
  };
  const canLeave = (): boolean | Promise<boolean> => {
    const editors = [...panel.querySelectorAll(".trip-cost-editor"), ...[...pendingCostEditors.values()].map(value => value.node)];
    if (!editors.length) return true;
    return confirmAction(document, "編集中の費用を破棄して移動しますか？").then(confirmed => { if (confirmed) { editors.forEach(editor => editor.remove()); pendingCostEditors.clear(); } return confirmed; });
  };
  const unsubscribeSaved = controller.subscribeSaved(proposal => notifySaved(document, proposal.patches.some(p => p.type === "remove") ? "予定を削除しました。" : proposal.patches.every(p => p.type === "request") ? "旅の条件を保存しました。" : "予定の変更を保存しました。"));
  const unsubscribe = controller.subscribe(render); render();
  return { panel, nav, render, show, report, canLeave, openTravelMode: showTravelMode,
    showPlan() { show("trip"); },
    destroy() { unsubscribeSaved(); unsubscribe(); panel.remove(); nav.remove(); delete app.dataset.tripWorkspace; delete app.dataset.tripWorkspaceView; } };
}

/** Display the authored calendar day without using the device timezone. */
function calendarDayLabel(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const day = new Date(`${value}T12:00:00Z`);
  return new Intl.DateTimeFormat("ja-JP", { month: "long", day: "numeric", weekday: "short", timeZone: "UTC" }).format(day);
}
