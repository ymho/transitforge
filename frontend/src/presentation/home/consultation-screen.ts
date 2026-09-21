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
  const head = node("header", "consultation-heading"), headingCopy = node("div", "consultation-heading-copy"), eyebrow = node("p", "home-eyebrow", "AI CONCIERGE"), title = node("h1", "", "相談");
  headingCopy.append(eyebrow, title);
  const fresh = node("button", "", "新しい相談"); fresh.type = "button"; fresh.addEventListener("click", ports.newConversation);
  head.append(headingCopy, fresh);
  // Keep secondary feature triggers alive, but discard the old panel heading/border/layout.
  if (oldActions) { oldActions.className = "consultation-secondary"; head.append(oldActions); }
  const context = node("section", "consultation-context"), identity = node("div", "consultation-identity");
  const name = node("strong", ""), meta = node("p", ""), note = node("small", "");
  identity.append(name, meta, note);
  const actions = node("div", "consultation-context-actions");
  const conditions = node("button", "consultation-conditions-toggle", "この旅の条件"), tripButton = node("button", "", "旅程を見る");
  const saveDraft = node("button", "", "この相談から仮旅程を保存"); saveDraft.type = "button";
  saveDraft.addEventListener("click", () => {
    if (saveDraft.disabled) return;
    const sessionId = ports.read().sessionId; saveDraft.disabled = true;
    void ports.saveDraftTrip?.().then(render, () => {
      if (ports.read().sessionId === sessionId) status.textContent = "旅程を保存できませんでした。相談内容はそのままです。もう一度お試しください。";
    }).finally(() => { saveDraft.disabled = false; });
  });
  conditions.type = tripButton.type = "button"; tripButton.addEventListener("click", ports.showTrip);
  actions.append(conditions, tripButton, saveDraft); context.append(identity, actions);
  messages.classList.remove("ai-guide-messages"); messages.classList.add("consultation-messages");
  form.classList.remove("ai-guide-form"); form.classList.add("consultation-composer");
  input.placeholder = "希望や気になることを話してください";
  const send = form.querySelector("button[type=submit]"); if (send) send.textContent = "送る";
  conversation.append(context, messages, form);
  const aside = node("aside", "consultation-conditions"); aside.id = "consultation-conditions";
  aside.setAttribute("aria-label", "この旅の条件"); conditions.setAttribute("aria-controls", aside.id);
  const close = node("button", "consultation-conditions-close", "閉じる"); close.type = "button";
  const rows = node("div", "consultation-condition-rows"), help = node("p", "consultation-help");
  const status = node("p", "consultation-edit-status"); status.setAttribute("role", "status");
  aside.append(close, node("h2", "", "今回の条件"), help, rows, status);
  const backdrop = node("button", "consultation-backdrop"); backdrop.type = "button"; backdrop.setAttribute("aria-label", "条件を閉じる"); backdrop.hidden = true;
  let previousOverflow = "";
  const sheet = (open: boolean) => {
    if (open) { previousOverflow = doc.body.style.overflow; doc.body.style.overflow = "hidden"; }
    else doc.body.style.overflow = previousOverflow;
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
  layout.append(head, conversation, aside, backdrop);
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
    const key = JSON.stringify([state, ports.profile()?.home]); if (key === lastKey) return; lastKey = key;
    const interruptedEditor = renderedSession === state.sessionId ? rows.querySelector(".consultation-condition-editor") : null;
    renderedSession = state.sessionId;
    if (aside.dataset.open === "true") sheet(false);
    rows.replaceChildren(); status.textContent = ""; aside.dataset.open = "false"; backdrop.hidden = true;
    conditions.setAttribute("aria-expanded", "false");
    name.textContent = trip ? `${trip.title}について相談中` : state.unavailable ? "対象の旅程を読み込めません" : "新しい旅を相談中";
    const dates = trip ? [...new Set(trip.items.map((i) => itineraryScheduleLabel(i.schedule).replace(/（[^）]*）$/, "")))].slice(0, 2) : [];
    const party = trip ? tripPartyView(trip)?.text : undefined;
    meta.textContent = [...dates, ...(party ? [party] : [])].join(" ・ "); meta.hidden = !meta.textContent;
    note.textContent = trip ? "この旅程が変更案の対象です。確認するまで反映されません。" : state.unavailable ? "参照先を確認してから相談を続けてください。" : "まだ旅程に紐付いていません。";
    tripButton.hidden = !trip;
    saveDraft.hidden = !!trip || !!state.unavailable || !ports.saveDraftTrip;
    help.textContent = trip ? state.viewer ? "閲覧専用の旅程です。条件の変更はできません。" : "条件を編集し、変更案を確認して保存できます。列車・宿・予約は自動で変更されません。"
      : "条件は会話で追加できます。普段の好みより、今回の希望を優先します。";
    const row = (label: string, value: string, edit?: () => void, source?: string) => {
      const item = node("div", "consultation-condition-row"); item.append(node("span", "", label), node("strong", "", value));
      if (source) item.append(node("small", "consultation-condition-source", source));
      if (edit) { const button = node("button", "", "編集"); button.type = "button"; button.setAttribute("aria-label", `${label}を編集`); button.addEventListener("click", edit); item.append(button); }
      rows.append(item); return item;
    };
    const editFields = (fields: ConditionField[], update: (values: Record<string, string>) => TripUpdateProposal) => {
      const existing = rows.querySelector(".consultation-condition-editor");
      if (existing && !doc.defaultView?.confirm("編集中の入力を破棄しますか？")) return;
      existing?.remove();
      const base = ports.read(), editor = node("form", "consultation-condition-editor");
      for (const spec of fields) {
        const label = node("label", "", spec.label);
        const field = spec.options ? node("select", "") : node("input", "");
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
          ports.preview(update(values)); status.textContent = "変更案を作成しました。旅程で内容を確認してください。まだ保存されていません。"; editor.remove();
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
        try { ports.preview(proposal()); } catch { status.textContent = "関連する予定に影響があります。旅程の変更案から確認してください。"; }
      }); return button;
    };
    if (trip) {
      row("旅の目的", trip.request.goal ?? "まだ決まっていません", state.viewer ? undefined : () => edit("旅の目的", trip.request.goal ?? "", (goal) =>
        proposeTripRequestUpdate(trip, { ...trip.request, goal: goal.trim() ? boundedConditionText(goal) : undefined }, "user")));
      for (const constraint of effectiveTripConstraints(trip.request)) {
        const r = constraint.requirement;
        const display = r.type === "origin" ? ["出発地", r.place.name] : r.type === "dates" ? ["日程", `${r.start.earliest}〜${r.end?.latest ?? r.start.latest}`]
          : r.type === "destinations" ? ["行き先", r.places.map((p) => p.name).join("、")]
          : r.type === "pace" ? ["ペース", r.value <= .4 ? "ゆっくり" : r.value >= .7 ? "いろいろ巡る" : "バランス"]
          : r.type === "experience" ? [r.intent === "avoid" ? "避けたいこと" : "好み", r.text]
          : r.type === "budget" ? ["予算", `${formatMoney(r.limit)}${r.basis === "per-person" ? " / 1人" : ""}`]
          : r.type === "mobility" ? ["移動", [r.maxTravelMinutes ? `移動 ${r.maxTravelMinutes}分まで` : "", r.maxTransfers !== undefined ? `乗換 ${r.maxTransfers}回まで` : "", r.transferPace ? `ペース: ${r.transferPace}` : ""].filter(Boolean).join(" ・ ") || "未定"]
          : r.type === "duration" ? ["日程", `${r.minimum}〜${r.maximum}${r.unit === "nights" ? "泊" : "日"}`]
          : r.type === "depart_after" ? ["出発", r.at.at]
          : r.type === "arrive_by" ? ["到着", r.at.at]
          : r.type === "relative_distance" ? ["距離", r.direction === "nearer" ? "もっと近く" : "もっと遠く"]
          : r.type === "adventure" ? ["移動", "冒険度を調整"] : undefined;
        if (!display) continue;
        const source = constraint.source === "user" ? "あなたが指定" : constraint.source === "profile" ? "プロフィール由来" : "仮置き";
        const editable = conditionKinds.some(([type]) => type === r.type);
        const item = row(display[0]!, display[1]!, !state.viewer && editable ? () => editConstraint(r.type as EditableCondition, constraint) : undefined, source);
        if (!state.viewer) item.append(offer(`${display[0]}を解除`, () => editTripConstraint(trip, constraint.id, undefined)));

      }
      row("同行者", party ?? "人数は未設定", state.viewer ? undefined : () => editFields([
        { key: "adults", label: "大人の人数（全て空欄で未設定）", type: "number", value: trip.request.party ? String(trip.request.party.adults) : "" },
        { key: "children", label: "子どもの年齢（カンマ区切り・不明は?）", value: trip.request.party?.children.map((child) => child.age === undefined ? "?" : String(child.age)).join(",") ?? "" },
      ], (v) => editTripParty(trip, v.adults!, v.children!)));
      if (!state.viewer) {
        const add = node("div", "consultation-add-condition"), kind = node("select", ""); kind.setAttribute("aria-label", "追加する条件");
        for (const [value, label] of conditionKinds) { const option = node("option", "", label); option.value = value; kind.append(option); }
        const button = node("button", "", "条件を追加"); button.type = "button"; button.addEventListener("click", () => editConstraint(kind.value as EditableCondition));
        add.append(kind, button); rows.append(add);
        for (const assumption of trip.request.assumptions.filter((a) => a.status === "unconfirmed")) {
          const item = row("仮置き", assumption.text);
          item.append(offer("仮定を承認", () => proposeAssumptionDecision(trip, assumption.id, "confirmed")),
            offer("仮定を拒否", () => proposeAssumptionDecision(trip, assumption.id, "rejected", [],
              trip.request.party?.assumptionId === assumption.id ? { type: "remove" } : undefined)));
        }
      }
      if (trip.items.length) rows.append(node("p", "consultation-help", "日程は今回の希望です。採用済みの予定・旅行履歴の分類は変わりません。条件と異なる予定は、旅程の変更案で別途確認してください。"));
    } else {
      const origin = ports.profile()?.home.station;
      if (origin) row("普段の出発駅", origin);
      row("今回の条件", "会話で追加できます");
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
