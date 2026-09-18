import type { TripWorkspaceController } from "../../usecases/trip-plan/trip-workspace-controller";
import type { ContextViewKind } from "../../domain/context-workspace";
import { proposeManualActivity } from "../../usecases/trip-plan/propose-trip-activity";
import { tripWorkspaceProjection, itemAssumptions } from "./trip-workspace-projection";
import { renderWorkspaceCard, refreshMoveTargets } from "./trip-workspace-card";
import { renderWorkspaceCandidates } from "./trip-workspace-candidates";
import { renderWorkspaceProposal } from "./trip-workspace-proposal";
import { element, control } from "./trip-workspace-elements";
import { renderTripFeasibility } from "./trip-feasibility-view";
import { renderTripReadiness } from "./trip-readiness-view";
import { renderTripChecklist } from "./trip-checklist-view";
import { travelIcon } from "../shared/travel-icon";

/** DOM and navigation only. The supplied source owns current Trip; legacy storage is never read here. */
export function configureTripWorkspace(options: {
  app: HTMLElement; chat: HTMLElement; messages: HTMLElement; input: HTMLInputElement;
  legacyPanel: HTMLElement; legacyToggle: HTMLElement; controller: TripWorkspaceController;
  showContext(view: ContextViewKind): void; returnToConversation(): void; showMap(): void;
  ask(prompt: string): void; nextItemId(): string;
}) {
  const { controller, app } = options;
  const panel = element("section", "trip-workspace"); panel.id = "trip-workspace"; panel.hidden = true;
  panel.setAttribute("aria-label", "Trip V2の旅程"); panel.tabIndex = -1;
  const nav = element("nav", "trip-workspace-navigation"); nav.setAttribute("aria-label", "会話と旅程の切替"); nav.hidden = true;
  const status = element("p", "trip-workspace-status"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const report = (text: string) => { status.textContent = text; };
  const heading = element("header", "trip-workspace-heading"); const title = element("h1"); const summary = element("p", "trip-workspace-copy");
  const emblem = element("span", "trip-workspace-emblem"); emblem.innerHTML = travelIcon("trip"); emblem.setAttribute("aria-hidden", "true");
  const notice = element("p", "trip-workspace-notice");
  heading.append(emblem, title, notice, summary);
  const retry = control("旅程を再読み込み", () => { void controller.source()?.retry?.(); });
  const assumptions = element("section", "trip-workspace-assumptions");
  const feasibility = element("div");
  const readiness = element("div"), checklist = element("div");
  let checklistKey = "";
  const days = element("div", "trip-workspace-days"), proposal = element("div"), candidates = element("div");
  const add = element("form", "trip-workspace-add"); const addLabel = element("label", "", "追加する予定 "); const addTitle = element("input");
  addTitle.required = true; addTitle.maxLength = 200; addLabel.append(addTitle);
  const submit = element("button", "", "時間未定の自由時間として追加案"); submit.type = "submit"; add.append(addLabel, submit);
  add.addEventListener("submit", (event) => {
    event.preventDefault(); const trip = controller.current(); if (!trip) return;
    try {
      controller.preview(proposeManualActivity(trip, { itemId: options.nextItemId(), operation: "add", ...(controller.uiFocus()?.itemId ? { afterId: controller.uiFocus()!.itemId } : {}) },
        { title: addTitle.value, category: "free-time", schedule: { type: "unscheduled" } }));
      report("追加案を表示しました。現在の旅程はまだ変更していません。");
    } catch { report("追加する予定の名称と対象を確認してください。"); }
  });
  const consult = control("＋ 予定を相談して追加", () => chat("旅程に追加する予定を相談したい"));
  panel.append(heading, status, retry, days, feasibility, readiness, checklist, assumptions, add, consult, proposal, candidates);
  app.append(panel, nav);
  const views = new Map<string, { scroll: number; chatScroll: number; view: "chat" | "trip"; focus?: HTMLElement }>();
  const collapsed = new Map<string, boolean>();
  const cards = new Map<string, { node: HTMLElement; key: string }>();
  const groups = new Map<string, HTMLElement>();
  let activeSession = controller.sessionId(), previousTripId: string | undefined, proposalKey = "", candidateKey = "";
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
    for (const button of [chatButton, tripButton]) button.setAttribute("aria-pressed", String(button === (view === "trip" ? tripButton : chatButton)));
    panel.scrollTop = state.scroll;
    if (view === "chat") { options.messages.scrollTop = state.chatScroll; (state.focus?.isConnected ? state.focus : options.input).focus({ preventScroll: true }); }
    else panel.focus({ preventScroll: true });
  };
  const chat = (prompt: string) => { show("chat"); options.ask(prompt); };
  const chatButton = control("会話", () => show("chat")), tripButton = control("旅程", () => show("trip"));
  chatButton.setAttribute("aria-controls", options.chat.id); tripButton.setAttribute("aria-controls", panel.id);
  nav.append(chatButton, tripButton, control("地図", options.showMap));

  const render = () => {
    if (activeSession !== controller.sessionId()) {
      viewState().scroll = panel.scrollTop; viewState().chatScroll = options.messages.scrollTop;
      activeSession = controller.sessionId(); previousTripId = undefined; report("");
    }
    const trip = controller.current();
    panel.hidden = nav.hidden = !controller.blocksLegacy();
    if (!controller.blocksLegacy()) { delete app.dataset.tripWorkspace; delete app.dataset.tripWorkspaceView; return; }
    app.dataset.tripWorkspace = "v2"; app.dataset.tripWorkspaceView = viewState().view;
    chatButton.setAttribute("aria-pressed", String(viewState().view === "chat"));
    tripButton.setAttribute("aria-pressed", String(viewState().view === "trip"));
    options.legacyPanel.hidden = true; options.legacyToggle.hidden = true;
    const server = controller.source()?.sourceState === "server-v2";
    notice.textContent = controller.source()?.getRole?.() === "viewer" ? "共有された旅程です（閲覧専用）。会話履歴・予約の個人情報は共有されません。"
      : controller.source()?.confirmationPersistence === "server" ? "変更案を確認するとサーバに保存します。競合した場合は最新の旅程で確認し直してください。"
      : server ? "サーバの旅程を参照しています。変更案は確認用プレビューで、まだ保存できません。"
      : controller.source()?.sourceState === "migration-pending" ? "旅程の移行は未完了です。元データは保持し、端末の旧旅程編集は停止しています。"
      : "確認用の旅程です。この画面での変更は永続保存されません。";
    retry.hidden = !controller.source()?.retry;
    retry.disabled = controller.loadState() === "loading";
    add.hidden = consult.hidden = !trip;
    if (!trip) {
      title.textContent = "旅程"; summary.textContent = "";
      report(controller.loadState() === "loading" ? "サーバから旅程を読み込んでいます。" : "旅程を取得できません。認証と接続、参照先の状態を確認して再試行してください。端末の旧旅程へは切り替えていません。");
      feasibility.replaceChildren(); assumptions.replaceChildren(); days.replaceChildren(); proposal.replaceChildren(); candidates.replaceChildren();
      readiness.replaceChildren(); checklist.replaceChildren(); checklistKey = "";
      cards.clear(); groups.clear(); previousTripId = undefined; proposalKey = candidateKey = "";
      return;
    }
    if (server) report("");
    if (previousTripId !== trip.id) {
      cards.clear(); groups.clear(); days.replaceChildren(); proposalKey = candidateKey = "";
      previousTripId = trip.id; panel.scrollTop = viewState().scroll;
    }
    const view = tripWorkspaceProjection(trip), scroll = panel.scrollTop;
    const evaluation = controller.feasibility()!;
    feasibility.replaceChildren(renderTripFeasibility(evaluation));
    const prepared = controller.readiness()!;
    readiness.replaceChildren(renderTripReadiness(prepared, trip, controller.focus));
    const nextChecklistKey = JSON.stringify([controller.sessionId(), trip, prepared.reservations, prepared.preparation, controller.checklist.items(), controller.checklist.proposal(), controller.checklist.canWrite()]);
    if (checklistKey !== nextChecklistKey) {
      checklistKey = nextChecklistKey;
      checklist.replaceChildren(renderTripChecklist({ controller: controller.checklist, trip, readiness: prepared, newId: () => crypto.randomUUID(), focus: controller.focus, ask: chat, report }));
    }
    title.textContent = view.title;
    const partyLabel = view.party.startsWith("今回の人数") ? view.party : `今回の人数: ${view.party}`;
    summary.textContent = `${view.state}\n${partyLabel}\n${view.places}`;
    assumptions.replaceChildren(...view.assumptions.map((a) => element("p", "trip-workspace-assumption", `⚠ 仮置き（${a.target}）: ${a.text}`)));
    const ids = new Set<string>(), dates = new Set<string>();
    for (const [date, items] of view.days) {
      dates.add(date);
      let group = groups.get(date);
      if (!group) { group = element("section", "trip-workspace-day"); group.append(element("h2", "", date)); groups.set(date, group); }
      if (days.children[[...dates].length - 1] !== group) days.insertBefore(group, days.children[[...dates].length - 1] ?? null);
      items.forEach((item, index) => {
        ids.add(item.id);
        const key = JSON.stringify([item, itemAssumptions(trip, item.id), controller.reservations()?.filter((r) => r.itineraryItemId === item.id), evaluation.issues.filter((i) => i.itemIds.includes(item.id))]);
        const collapseKey = `${activeSession}:${trip.id}:${item.id}`;
        let card = cards.get(item.id);
        if (card?.key !== key) {
          const node = renderWorkspaceCard(trip, item, controller, { collapsed: collapsed.get(collapseKey) ?? false,
            collapse: (value) => collapsed.set(collapseKey, value), chat, report }, evaluation.issues.filter((i) => i.itemIds.includes(item.id)));
          if (card) card.node.replaceWith(node);
          card = { node, key }; cards.set(item.id, card);
        }
        card.node.classList.toggle("is-focused", controller.uiFocus()?.itemId === item.id);
        refreshMoveTargets(card.node, trip, item.id);
        card.node.querySelector(".trip-workspace-item-focus")?.setAttribute("aria-pressed", String(controller.uiFocus()?.itemId === item.id));
        if (group!.children[index + 1] !== card.node) group!.insertBefore(card.node, group!.children[index + 1] ?? null);
      });
    }
    for (const [id, card] of cards) if (!ids.has(id)) { card.node.remove(); cards.delete(id); }
    for (const [date, group] of groups) if (!dates.has(date)) { group.remove(); groups.delete(date); }
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
  const unsubscribe = controller.subscribe(render); render();
  return { panel, nav, render, show, report, destroy() { unsubscribe(); panel.remove(); nav.remove(); delete app.dataset.tripWorkspace; delete app.dataset.tripWorkspaceView; } };
}
