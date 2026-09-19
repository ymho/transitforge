import type { Trip, TripUpdateProposal } from "@raiquora/trip/trip";
import { proposeTripRequestUpdate } from "../../usecases/trip-plan/update-trip-request";
import { itineraryScheduleLabel } from "../../usecases/trip-plan/itinerary-schedule-label";
import { tripPartyView } from "../../usecases/trip-plan/trip-party-presentation";
import type { UserProfile } from "@raiquora/trip/travel-profile";

export interface ConsultationScreenPorts {
  /** Only the active Conversation's explicitly attached source; never the first Home Trip. */
  read(): { sessionId: string; trip?: Trip; unavailable?: boolean; viewer?: boolean };
  profile(): UserProfile | undefined;
  subscribe(listener: () => void): () => void;
  preview(proposal: TripUpdateProposal): void;
  showTrip(): void;
  newConversation(): void;
  saveDraftTrip?(): Promise<void>;
}

/** New screen composition; retained DOM nodes preserve send/stream/history/IME/draft listeners. */
export function configureConsultationScreen(panel: HTMLElement, messages: HTMLOListElement,
  form: HTMLFormElement, input: HTMLInputElement, ports: ConsultationScreenPorts) {
  const doc = panel.ownerDocument;
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) => {
    const value = doc.createElement(tag); value.className = className; if (text) value.textContent = text; return value;
  };
  const oldActions = panel.querySelector(".guide-panel-actions");
  const layout = node("div", "consultation-layout"), conversation = node("section", "consultation-conversation");
  const head = node("header", "consultation-heading"), title = node("h1", "", "AI旅の相談");
  const fresh = node("button", "", "新しい相談"); fresh.type = "button"; fresh.addEventListener("click", ports.newConversation);
  head.append(title, fresh);
  // Keep secondary feature triggers alive, but discard the old panel heading/border/layout.
  if (oldActions) { oldActions.className = "consultation-secondary"; head.append(oldActions); }
  const context = node("section", "consultation-context"), identity = node("div", "consultation-identity");
  const name = node("strong", ""), meta = node("p", ""), note = node("small", "");
  identity.append(name, meta, note);
  const actions = node("div", "consultation-context-actions");
  const conditions = node("button", "consultation-conditions-toggle", "この旅の条件"), tripButton = node("button", "", "旅程を見る");
  const saveDraft = node("button", "", "この相談から仮旅程を保存"); saveDraft.type = "button";
  saveDraft.addEventListener("click", () => { void ports.saveDraftTrip?.().then(render, () => { status.textContent = "旅程を保存できませんでした。相談内容はそのままです。もう一度お試しください。"; }); });
  conditions.type = tripButton.type = "button"; tripButton.addEventListener("click", ports.showTrip);
  actions.append(conditions, tripButton, saveDraft); context.append(identity, actions);
  messages.classList.remove("ai-guide-messages"); messages.classList.add("consultation-messages");
  form.classList.remove("ai-guide-form"); form.classList.add("consultation-composer");
  input.placeholder = "希望や気になることを話してください";
  const send = form.querySelector("button[type=submit]"); if (send) send.textContent = "送る";
  conversation.append(head, context, messages, form);
  const aside = node("aside", "consultation-conditions"); aside.id = "consultation-conditions";
  aside.setAttribute("aria-label", "この旅の条件"); conditions.setAttribute("aria-controls", aside.id);
  const close = node("button", "consultation-conditions-close", "閉じる"); close.type = "button";
  const rows = node("div", "consultation-condition-rows"), help = node("p", "consultation-help");
  const status = node("p", "consultation-edit-status"); status.setAttribute("role", "status");
  aside.append(close, node("h2", "", "今回の条件"), help, rows, status,
    node("p", "consultation-coverage", "収録時刻表と取得できた情報をもとに案内します。未確認の移動や予約を、成立済みとは扱いません。"));
  const backdrop = node("button", "consultation-backdrop"); backdrop.type = "button"; backdrop.setAttribute("aria-label", "条件を閉じる"); backdrop.hidden = true;
  const sheet = (open: boolean) => {
    aside.dataset.open = String(open); backdrop.hidden = !open; conditions.setAttribute("aria-expanded", String(open));
    if (open) close.focus(); else conditions.focus();
  };
  conditions.addEventListener("click", () => sheet(true)); close.addEventListener("click", () => sheet(false)); backdrop.addEventListener("click", () => sheet(false));
  aside.addEventListener("keydown", (event) => { if (event.key === "Escape") sheet(false); });
  layout.append(conversation, aside, backdrop);
  panel.classList.remove("ai-guide-panel"); panel.classList.add("consultation-page"); panel.replaceChildren(layout);
  let lastKey = "";
  const render = () => {
    const state = ports.read(), trip = state.trip;
    const key = JSON.stringify([state, ports.profile()?.home]); if (key === lastKey) return; lastKey = key;
    rows.replaceChildren(); status.textContent = ""; aside.dataset.open = "false"; backdrop.hidden = true;
    conditions.setAttribute("aria-expanded", "false");
    name.textContent = trip ? `${trip.title}について相談中` : state.unavailable ? "対象の旅程を読み込めません" : "新しい旅を相談中";
    const dates = trip ? [...new Set(trip.items.map((i) => itineraryScheduleLabel(i.schedule).replace(/（[^）]*）$/, "")))].slice(0, 2) : [];
    const party = trip ? tripPartyView(trip)?.text : undefined;
    meta.textContent = [...dates, ...(party ? [party] : [])].join(" ・ "); meta.hidden = !meta.textContent;
    note.textContent = trip ? "この旅程が変更案の対象です。確認するまで反映されません。" : state.unavailable ? "参照先を確認してから相談を続けてください。" : "まだ旅程に紐付いていません。";
    tripButton.hidden = !trip;
    saveDraft.hidden = !!trip || !ports.saveDraftTrip;
    help.textContent = trip ? state.viewer ? "閲覧専用の旅程です。条件の変更はできません。" : "出発地と旅の目的はここで編集できます。日程などの追加条件は会話で確認し、変更案として保存します。"
      : "条件は会話で追加できます。普段の好みより、今回の希望を優先します。";
    const row = (label: string, value: string, edit?: () => void, source?: string) => {
      const item = node("div", "consultation-condition-row"); item.append(node("span", "", label), node("strong", "", value));
      if (source) item.append(node("small", "consultation-condition-source", source));
      if (edit) { const button = node("button", "", "編集"); button.type = "button"; button.setAttribute("aria-label", `${label}を編集`); button.addEventListener("click", edit); item.append(button); }
      rows.append(item); return item;
    };
    const edit = (label: string, value: string, update: (value: string) => TripUpdateProposal) => {
      const base = ports.read(); const editor = node("form", "consultation-condition-editor");
      const field = node("input", ""); field.value = value; field.maxLength = 240; field.required = true; field.setAttribute("aria-label", label);
      const preview = node("button", "", "変更案を確認"), cancel = node("button", "", "取消"); preview.type = "submit"; cancel.type = "button";
      cancel.addEventListener("click", () => editor.remove()); editor.append(field, preview, cancel); rows.append(editor); field.focus();
      editor.addEventListener("submit", (event) => {
        event.preventDefault();
        const current = ports.read();
        if (current.sessionId !== base.sessionId || current.trip?.id !== base.trip?.id || current.trip?.revision !== base.trip?.revision) {
          status.textContent = "対象の旅程が変わりました。現在の条件から編集し直してください。"; return;
        }
        try { ports.preview(update(field.value.trim())); status.textContent = "変更案を作成しました。旅程で内容を確認してください。まだ保存されていません。"; editor.remove(); }
        catch { status.textContent = "この条件では変更案を作成できません。入力と旅程の状態を確認してください。"; }
      });
    };
    if (trip) {
      row("旅の目的", trip.request.goal ?? "まだ決まっていません", state.viewer ? undefined : () => edit("旅の目的", trip.request.goal ?? "", (goal) =>
        proposeTripRequestUpdate(trip, { ...trip.request, goal }, "user")));
      for (const constraint of trip.request.constraints) {
        const r = constraint.requirement;
        const display = r.type === "origin" ? ["出発地", r.place.name] : r.type === "dates" ? ["日程", `${r.start.earliest}〜${r.end?.latest ?? r.start.latest}`]
          : r.type === "destinations" ? ["行き先", r.places.map((p) => p.name).join("、")]
          : r.type === "pace" ? ["ペース", r.value <= .4 ? "ゆっくり" : r.value >= .7 ? "いろいろ巡る" : "バランス"]
          : r.type === "experience" ? [r.intent === "avoid" ? "避けたいこと" : "好み", r.text]
          : r.type === "budget" ? ["予算", `${r.limit.currency} ${r.limit.amountMinor.toLocaleString()}${r.basis === "per-person" ? " / 1人" : ""}`]
          : r.type === "mobility" ? ["移動", [r.maxTravelMinutes ? `移動 ${r.maxTravelMinutes}分まで` : "", r.maxTransfers !== undefined ? `乗換 ${r.maxTransfers}回まで` : "", r.transferPace ? `ペース: ${r.transferPace}` : ""].filter(Boolean).join(" ・ ") || "未定"]
          : r.type === "duration" ? ["日程", `${r.minimum}〜${r.maximum}${r.unit === "nights" ? "泊" : "日"}`]
          : r.type === "depart_after" ? ["出発", r.at.at]
          : r.type === "arrive_by" ? ["到着", r.at.at]
          : r.type === "relative_distance" ? ["距離", r.direction === "nearer" ? "もっと近く" : "もっと遠く"]
          : r.type === "adventure" ? ["移動", "冒険度を調整"] : undefined;
        if (!display) continue;
        const source = constraint.source === "user" ? "あなたが指定" : constraint.source === "profile" ? "プロフィール由来" : "仮置き";
        row(display[0]!, display[1]!, !state.viewer && r.type === "origin" && constraint.source === "user" && !constraint.assumptionId
          ? () => edit("出発地", r.place.name, (name) => proposeTripRequestUpdate(trip, { ...trip.request,
            constraints: trip.request.constraints.map((c) => c.id === constraint.id ? { ...c, requirement: { type: "origin", place: { name, sources: [] } } } : c) }, "user")) : undefined, source);
      }
      if (party) row("同行者", party);
    } else {
      const origin = ports.profile()?.home.station;
      if (origin) row("普段の出発駅", origin);
      row("今回の条件", "会話で相談できます");
      const add = node("button", "consultation-add-condition", "条件を入力する"); add.type = "button";
      add.addEventListener("click", () => { sheet(false); input.focus(); }); rows.append(add);
    }
  };
  ports.subscribe(render); render();
  doc.addEventListener("transitforge:travel-profile-changed", render);
  return { refresh: render };
}
