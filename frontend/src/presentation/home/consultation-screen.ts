import type { Trip, TripUpdateProposal } from "@raiquora/trip/trip";
import { proposeTripRequestUpdate } from "../../usecases/trip-plan/update-trip-request";
import { itineraryScheduleLabel } from "../../usecases/trip-plan/itinerary-schedule-label";
import { tripPartyView } from "../../usecases/trip-plan/trip-party-presentation";
import { editTripConstraint, editTripParty, boundedConditionText, type EditableCondition } from "../../usecases/trip-plan/edit-trip-conditions";
import { conditionFields, conditionKinds, type ConditionField } from "./condition-fields";
import { proposeAssumptionDecision } from "../../usecases/trip-plan/update-trip-request";
import { effectiveTripConstraints, type TripConstraint } from "@raiquora/trip/trip-request";
import { formatMoney } from "@raiquora/trip/money";
import type { UserProfile } from "@raiquora/trip/travel-profile";
import { adoptComposer, createButton, createPageHeading, iconMarkup } from "../shared/primitives";

export interface ConsultationScreenPorts {
  /** Only the active Conversation's explicitly attached source; never the first Home Trip. */
  read(): { sessionId: string; trip?: Trip; unavailable?: boolean; viewer?: boolean };
  profile(): UserProfile | undefined;
  subscribe(listener: () => void): () => void;
  preview(proposal: TripUpdateProposal): void;
  showTrip(): void;
  newConversation(): void;
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
  const head = node("div", "consultation-heading"), headingCopy = createPageHeading(doc, "AI CONCIERGE", "相談"); headingCopy.classList.add("consultation-heading-copy");
  const fresh = createButton(doc, "新しい相談");
  fresh.setAttribute("aria-label", "新しい相談"); fresh.title = "新しい相談"; fresh.addEventListener("click", ports.newConversation);
  head.append(headingCopy, fresh);
  // Keep secondary feature triggers alive, but discard the old panel heading/border/layout.
  if (oldActions) { oldActions.className = "consultation-secondary"; head.append(oldActions); }
  const context = node("section", "consultation-context"), identity = node("div", "consultation-identity");
  const name = node("strong", ""), meta = node("p", ""), note = node("small", "");
  identity.append(name, meta, note);
  const actions = node("div", "consultation-context-actions");
  const conditions = node("button", "consultation-conditions-toggle", "この旅の条件"), tripButton = node("button", "consultation-trip-link");
  conditions.type = tripButton.type = "button"; tripButton.addEventListener("click", ports.showTrip);
  actions.append(conditions);
  tripButton.innerHTML = iconMarkup("back"); tripButton.append(name); identity.prepend(tripButton);
  context.append(identity, actions);
  messages.classList.remove("ai-guide-messages"); messages.classList.add("consultation-messages");
  form.classList.remove("ai-guide-form"); form.classList.add("consultation-composer");
  input.placeholder = "希望や気になることを話してください";
  const send = form.querySelector<HTMLButtonElement>("button[type=submit]"); if (send) {
    adoptComposer(form, input, send); send.innerHTML = iconMarkup("send"); send.setAttribute("aria-label", "送信"); send.title = "送信";
  }
  const dock = node("div", "consultation-composer-dock");
  context.append(head); dock.append(context, form); conversation.append(messages, dock);
  const aside = node("aside", "consultation-conditions"); aside.id = "consultation-conditions";
  aside.setAttribute("aria-label", "この旅の条件"); conditions.setAttribute("aria-controls", aside.id);
  const close = node("button", "consultation-conditions-close", "閉じる"); close.type = "button";
  const rows = node("div", "consultation-condition-rows"), help = node("p", "consultation-help");
  const status = node("p", "consultation-edit-status"); status.setAttribute("role", "status");
  aside.append(close, node("h2", "", "今回の条件"), help, rows, status);
  const backdrop = node("button", "consultation-backdrop"); backdrop.type = "button"; backdrop.setAttribute("aria-label", "条件を閉じる"); backdrop.hidden = true;
  let previousOverflow = "";
  const sheet = (open: boolean) => {
    if (open && aside.dataset.open !== "true") { previousOverflow = doc.body.style.overflow; doc.body.style.overflow = "hidden"; }
    else if (!open) doc.body.style.overflow = previousOverflow;
    aside.dataset.open = String(open); backdrop.hidden = !open; conditions.setAttribute("aria-expanded", String(open));
    if (open) close.focus(); else conditions.focus();
  };
  conditions.addEventListener("click", () => sheet(true)); close.addEventListener("click", () => sheet(false)); backdrop.addEventListener("click", () => sheet(false));
  aside.addEventListener("keydown", (event) => {
    if (event.key === "Escape") sheet(false);
    if (event.key === "Tab" && aside.dataset.open === "true") {
      const focusable = [...aside.querySelectorAll<HTMLElement>('button:not(:disabled), input, select')].filter((e) => !e.hidden);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  });
  layout.append(conversation, aside, backdrop);
  panel.classList.remove("ai-guide-panel"); panel.classList.add("consultation-page"); panel.replaceChildren(layout);
  let lastKey = "";
  const canLeave = () => {
    const editor = rows.querySelector(".consultation-condition-editor");
    if (!editor || doc.defaultView?.confirm("編集中の条件を破棄して移動しますか？")) { editor?.remove(); return true; }
    return false;
  };
  let renderedSession = "";
  const render = () => {
    const state = ports.read(), trip = state.trip;
    const key = JSON.stringify([state, ports.profile()?.usualOrigin]); if (key === lastKey) return; lastKey = key;
    const interruptedEditor = renderedSession === state.sessionId ? rows.querySelector(".consultation-condition-editor") : null;
    renderedSession = state.sessionId;
    if (aside.dataset.open === "true") sheet(false);
    rows.replaceChildren(); status.textContent = ""; aside.dataset.open = "false"; backdrop.hidden = true;
    conditions.setAttribute("aria-expanded", "false");
    name.textContent = trip ? trip.title : state.unavailable ? "対象の旅程を読み込めません" : "新しい旅を相談中";
    const dates = trip ? [...new Set(trip.items.map((i) => itineraryScheduleLabel(i.schedule).replace(/（[^）]*）$/, "")))].slice(0, 2) : [];
    const party = trip ? tripPartyView(trip)?.text : undefined;
    meta.textContent = [...dates, ...(party ? [party] : [])].join(" ・ "); meta.hidden = true;
    note.hidden = true;
    note.textContent = trip ? "会話で受理した今回条件は旅程に保存されます。手動編集は変更案を確認して保存します。" : state.unavailable ? "参照先を確認してから相談を続けてください。" : "まだ旅程に紐付いていません。";
    tripButton.disabled = !trip;
    tripButton.setAttribute("aria-label", trip ? `${trip.title}の旅程に戻る` : name.textContent!);
    tripButton.querySelector("svg")!.toggleAttribute("hidden", !trip);
    help.textContent = trip ? state.viewer ? "閲覧専用の旅程です。条件の変更はできません。" : ""
      : "条件は会話で追加できます。普段の好みより、今回の希望を優先します。";
    help.hidden = !help.textContent;
    const row = (label: string, value: string, edit?: () => void, _source?: string) => {
      const item = node("div", "consultation-condition-row"); item.append(node("span", "", label), node("strong", "", value));
      const actions = node("div", "consultation-condition-actions");
      if (edit) { const button = node("button", "", "編集"); button.type = "button"; button.setAttribute("aria-label", `${label}を編集`); button.addEventListener("click", edit); actions.append(button); }
      item.append(actions);
      rows.append(item); return item;
    };
    const previewProposal = (proposal: TripUpdateProposal) => ports.preview(proposal);
    const editFields = (fields: ConditionField[], update: (values: Record<string, string>) => TripUpdateProposal) => {
      const existing = rows.querySelector(".consultation-condition-editor");
      if (existing && !doc.defaultView?.confirm("編集中の入力を破棄しますか？")) return;
      existing?.remove();
      const base = ports.read(), editor = node("form", "consultation-condition-editor");
      for (const spec of fields) {
        const label = node("label", "", spec.label);
        const field = spec.options ? node("select", "ds-control") : node("input", "ds-control");
        field.name = spec.key; field.setAttribute("aria-label", spec.label);
        if (field.tagName === "SELECT") for (const [value, title] of spec.options!) {
          const option = node("option", "", title); option.value = value; field.append(option);
        }
        else { (field as HTMLInputElement).type = spec.type ?? "text"; (field as HTMLInputElement).maxLength = 240; }
        field.value = spec.value; label.append(field); editor.append(label);
      }
      const preview = node("button", "", "変更案を確認"), cancel = node("button", "", "取消"); preview.type = "submit"; cancel.type = "button";
      cancel.addEventListener("click", () => editor.remove()); editor.append(preview, cancel); rows.append(editor); editor.querySelector<HTMLElement>("input, select")?.focus();
      editor.addEventListener("submit", (event) => {
        event.preventDefault();
        const current = ports.read();
        if (current.viewer || current.unavailable || current.sessionId !== base.sessionId || current.trip?.id !== base.trip?.id || current.trip?.revision !== base.trip?.revision) {
          status.textContent = "対象の旅程が変わりました。現在の条件から編集し直してください。"; return;
        }
        try {
          const values: Record<string, string> = {};
          for (const field of editor.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select")) values[field.name] = field.value.trim();
          previewProposal(update(values)); status.textContent = "変更案を作成しました。旅程で内容を確認してください。まだ保存されていません。"; editor.remove();
        } catch (error) { status.textContent = error instanceof Error ? `入力と旅程の状態を確認してください。${error.message}` : "この条件では変更案を作成できません。"; }
      });
    };
    const edit = (label: string, value: string, update: (value: string) => TripUpdateProposal) =>
      editFields([{ key: "value", label, value }], (values) => update(values.value!));
    const editConstraint = (type: EditableCondition, constraint?: TripConstraint) => {
      const schema = conditionFields(type, constraint?.requirement);
      editFields([...schema.fields, { key: "strength", label: "条件の強さ", value: constraint?.strength ?? "hard", options: [["hard", "必須"], ["soft", "できれば"]] }],
        (values) => editTripConstraint(trip!, constraint?.id ?? crypto.randomUUID(), schema.parse(values), values.strength === "soft" ? "soft" : "hard"));
    };
    const offer = (label: string, proposal: () => TripUpdateProposal) => {
      const button = node("button", "", label); button.type = "button";
      button.addEventListener("click", () => {
        const current = ports.read();
        if (current.sessionId !== state.sessionId || current.trip?.id !== trip?.id || current.trip?.revision !== trip?.revision || current.viewer) return;
        try { previewProposal(proposal()); } catch { status.textContent = "関連する予定に影響があります。旅程の変更案から確認してください。"; }
      }); return button;
    };
    if (trip) {
      if (trip.request.goal?.trim()) row("旅の目的", trip.request.goal, state.viewer ? undefined : () => edit("旅の目的", trip.request.goal ?? "", (goal) =>
        proposeTripRequestUpdate(trip, { ...trip.request, goal: goal.trim() ? boundedConditionText(goal) : undefined }, "user")));
      for (const constraint of effectiveTripConstraints(trip.request)) {
        const r = constraint.requirement;
        const display = r.type === "origin" ? ["出発地", r.place.name] : r.type === "dates" ? ["日程", `${r.start.earliest === r.start.latest ? r.start.earliest : `${r.start.earliest}〜${r.start.latest}に出発`}〜${r.end?.latest ?? "終了日未定"}`]
          : r.type === "destinations" ? ["行き先", r.places.map((p) => p.name).join("、")]
          : r.type === "pace" ? ["ペース", r.value <= .4 ? "ゆっくり" : r.value >= .7 ? "いろいろ巡る" : "バランス"]
          : r.type === "experience" ? [r.intent === "avoid" ? "避けたいこと" : "好み", r.text]
          : r.type === "budget" ? ["予算", `${formatMoney(r.limit)}${r.basis === "per-person" ? " / 1人" : ""}`]
          : r.type === "mobility" ? ["移動", [r.maxTravelMinutes ? `移動 ${r.maxTravelMinutes}分まで` : "", r.maxTransfers !== undefined ? `乗換 ${r.maxTransfers}回まで` : "", r.transferPace ? `ペース: ${r.transferPace}` : ""].filter(Boolean).join(" ・ ")]
          : r.type === "duration" ? ["泊数・日数", `${r.minimum === r.maximum ? r.minimum : `${r.minimum}〜${r.maximum}`}${r.unit === "nights" ? "泊" : "日"}`]
          : r.type === "depart_after" ? ["出発", r.at.at]
          : r.type === "arrive_by" ? ["到着", r.at.at]
          : r.type === "relative_distance" ? ["距離", r.direction === "nearer" ? "もっと近く" : "もっと遠く"]
          : r.type === "adventure" ? ["移動", "冒険度を調整"] : undefined;
        if (!display || !display[1]?.trim()) continue;
        const source = constraint.source === "user" ? "あなたが指定" : constraint.source === "profile" ? "プロフィール由来" : "仮置き";
        const editable = conditionKinds.some(([type]) => type === r.type);
        const item = row(display[0]!, display[1]!, !state.viewer && editable ? () => editConstraint(r.type as EditableCondition, constraint) : undefined, source);
        if (!state.viewer) {
          const remove = offer("削除", () => editTripConstraint(trip, constraint.id, undefined));
          remove.setAttribute("aria-label", `${display[0]}を削除`);
          item.querySelector(".consultation-condition-actions")!.append(remove);
        }

      }
      for (const fact of trip.request.partialConditions ?? []) {
        const value = fact.value;
        if (fact.target === "end_date" && value.kind === "local_date" && effectiveTripConstraints(trip.request).some(({ requirement }) =>
          requirement.type === "dates" && requirement.end?.earliest === value.date && requirement.end?.latest === value.date)) continue;
        const display = fact.target === "party_size" && fact.value.kind === "quantity" && fact.value.unit === "people"
          ? ["同行者", `${fact.value.amount}人（内訳未定）`]
          : fact.target === "party_size" && fact.value.kind === "party" ? ["同行者", party ?? "人数は未設定"]
          : fact.target === "budget" && fact.value.kind === "money"
            ? ["予算", `${fact.value.amount}${fact.value.currency ? ` ${fact.value.currency}` : "（通貨未定）"}${fact.value.basis === "per_person" ? " / 1人" : fact.value.basis === "trip" ? " / 旅行全体" : "（対象未定）"}`]
            : fact.target === "end_date" && fact.value.kind === "local_date" ? ["日程", `終了 ${fact.value.date}（開始日未定）`]
            : fact.target === "start_date" && fact.value.kind === "local_date" ? ["日程", `開始 ${fact.value.date}`]
            : fact.target === "duration" && fact.value.kind === "quantity" ? ["日程", `${fact.value.amount}${fact.value.unit === "nights" ? "泊" : "日"}`]
            : undefined;
        if (display) row(display[0]!, display[1]!, undefined, "あなたが指定");
      }
      const partialParty = (trip.request.partialConditions ?? []).some(({ target }) => target === "party_size");
      const editParty = () => editFields([
        { key: "adults", label: "大人の人数（全て空欄で未設定）", type: "number", value: trip.request.party ? String(trip.request.party.adults) : "" },
        { key: "children", label: "子どもの年齢（カンマ区切り・不明は?）", value: trip.request.party?.children.map((child) => child.age === undefined ? "?" : String(child.age)).join(",") ?? "" },
      ], (v) => editTripParty(trip, v.adults!, v.children!));
      if (!partialParty && party) row("同行者", party, state.viewer ? undefined : editParty);
      if (!state.viewer) {
        for (const assumption of trip.request.assumptions.filter((a) => a.status === "unconfirmed")) {
          const item = row("仮置き", assumption.text);
          item.querySelector(".consultation-condition-actions")!.append(offer("仮定を承認", () => proposeAssumptionDecision(trip, assumption.id, "confirmed")),
            offer("仮定を拒否", () => proposeAssumptionDecision(trip, assumption.id, "rejected", [],
              trip.request.party?.assumptionId === assumption.id ? { type: "remove" } : undefined)));
        }
      }
    } else {
      const origin = ports.profile()?.usualOrigin;
      if (origin) row("普段の出発地", origin);
    }
    if (interruptedEditor && trip && !state.viewer) {
      rows.append(interruptedEditor);
      status.textContent = "旅程が更新されました。入力は残しています。取消後、最新の条件から編集し直してください。";
    }
  };
  ports.subscribe(render); render();
  doc.addEventListener("transitforge:travel-profile-changed", render);
    doc.defaultView?.addEventListener("beforeunload", (event) => {
    if (rows.querySelector(".consultation-condition-editor")) { event.preventDefault(); event.returnValue = ""; }
  });
  return { refresh: render, canLeave };
}
