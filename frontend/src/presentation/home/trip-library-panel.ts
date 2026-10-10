import { notifySaved } from "../shared/save-notification";
import type { TripLibraryClient } from "../../usecases/trip-plan/trip-library-client";
import type { OfficialGuide } from "@raiquora/trip/official-guide";
import { tripCoverImage } from "../shared/trip-cover";
import { loadingMarkup } from "../shared/primitives";
import { element, control } from "../trip-plan/trip-workspace-elements";
export function configureTripLibrary(root: HTMLElement, own: HTMLElement, client: TripLibraryClient, options: {
  openTrip(id: string): Promise<void> | void; session(): number; authenticated(): boolean;
  officialOnly?: boolean; login?(): void;
}) {
  const initialCategory = options.officialOnly ? "official" : "own";
  let selected = initialCategory, epoch = options.session(), disposed = false;
  const dialogs = new Set<HTMLDialogElement>();
  const closeDialogs = () => { for (const dialog of dialogs) { dialog.close(); dialog.remove(); } dialogs.clear(); };
  const tabs = element("div", "trip-library-tabs"); tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", "旅程の種類");
  const panel = element("section"), status = element("p"), entries = element("div", "trip-library-entries"), more = element("div", "trip-library-more"); status.setAttribute("role", "status");
  if (!options.officialOnly) panel.setAttribute("role", "tabpanel"); panel.id = options.officialOnly ? "home-official-catalog" : "trip-library-catalog";
  if (!options.officialOnly) own.setAttribute("role", "tabpanel"); own.id ||= options.officialOnly ? "home-official-unused" : "trip-library-own";
  panel.append(status, entries, more); if (!options.officialOnly) root.insertBefore(tabs, own); root.append(panel);
  type State = { entries: HTMLElement[]; busy: boolean; loaded: boolean; error: boolean; ownedAfter?: string; joinedAfter?: string; officialAfter?: string; ownedDone?: boolean; joinedDone?: boolean; seen: Set<string> };
  const states = new Map<string, State>();
  const state = () => { let s = states.get(selected); if (!s) { s = { entries: [], busy: false, loaded: false, error: false, seen: new Set() }; states.set(selected, s); } return s; };
  const buttons = new Map<string, HTMLButtonElement>();
  const paint = () => {
    own.hidden = selected !== "own"; panel.hidden = selected === "own";
    for (const [key, button] of buttons) { button.setAttribute("aria-selected", String(key === selected)); button.tabIndex = key === selected ? 0 : -1; }
    if (selected === "own") return;
    if (!options.officialOnly) panel.setAttribute("aria-labelledby", `trip-library-tab-${selected}`);
    const s = state(); entries.replaceChildren(...s.entries); more.replaceChildren();
    status.setAttribute("aria-busy", String(s.busy));
    if (!options.authenticated()) {
      status.textContent = "ログインすると公式しおりを選べます。";
      if (options.login) more.append(control("ログイン", options.login));
      return;
    }
    if (s.busy) status.innerHTML = loadingMarkup("しおりを読み込んでいます。");
    else status.textContent = s.error ? "読み込めませんでした。もう一度お試しください。" : s.entries.length ? "" : selected === "official" ? "公開された公式しおりはまだありません。" : "共有中の旅はまだありません。";
    if (s.loaded && !s.busy) more.append(control("再読み込み", () => { states.delete(selected); paint(); void load(); }));
    if (s.error || s.loaded && (selected === "official" ? s.officialAfter : !s.ownedDone || !s.joinedDone)) more.append(control(s.error ? "再試行" : "さらに表示", () => { void load(); }));
  };
  const load = async () => {
    const category = selected, session = options.session(), s = state(); if (s.busy || category === "own" || !options.authenticated()) return;
    s.busy = true; s.error = false; paint();
    try {
      if (category === "official") {
        const page = await client.officialList(s.officialAfter);
        if (disposed || session !== options.session() || !options.authenticated()) return;
        for (const guide of page.guides) if (!s.seen.has(guide.id)) {
          s.seen.add(guide.id); const card = catalogueCard(guide.id);
          card.append(element("strong", "", guide.trip.title), element("p", "", `公式しおり · ${guide.trip.timeline?.logicalDays.length ?? 0}日間`), control("しおりを見る", () => { void preview(guide); })); s.entries.push(card);
        }
        s.officialAfter = page.after;
      } else {
        const owned = s.ownedDone ? undefined : await client.ownedShared(s.ownedAfter);
        const joined = s.joinedDone ? undefined : await client.accessible(s.joinedAfter);
        if (disposed || session !== options.session() || !options.authenticated()) return;
        for (const entry of [...owned?.trips ?? [], ...joined?.trips ?? []]) if (!s.seen.has(entry.trip.id)) {
          s.seen.add(entry.trip.id); const card = catalogueCard(entry.trip.id);
          card.append(element("strong", "", entry.trip.title), element("p", "", entry.role === "owner" ? "共有中 · あなたの旅" : entry.role === "editor" ? "共有 · 共同編集" : "共有 · 閲覧のみ"),
            control("旅程を開く", () => { void Promise.resolve(options.openTrip(entry.trip.id)).catch(() => { status.textContent = "旅程を開けません。共有の解除・期限・接続を確認してください。"; }); })); s.entries.push(card);
        }
        if (owned) { s.ownedAfter = owned.afterTripId; s.ownedDone = !owned.afterTripId; }
        if (joined) { s.joinedAfter = joined.afterTripId; s.joinedDone = !joined.afterTripId; }
      }
      s.loaded = true;
    } catch { if (session === options.session()) s.error = true; }
    finally { s.busy = false; if (session === options.session() && category === selected) paint(); }
  };
  async function preview(initial: OfficialGuide) {
    const session = options.session(); let guide: OfficialGuide;
    try { guide = await client.officialGet(initial.id); } catch { status.textContent = "公開状態が変わったか、取得できませんでした。再読み込みしてください。"; return; }
    if (disposed || session !== options.session() || !options.authenticated()) return;
    const dialog = element("dialog", "trip-sharing-panel"), feedback = element("p"); feedback.setAttribute("role", "status");
    const close = control("閉じる", () => { dialog.close(); dialog.remove(); dialogs.delete(dialog); });
    dialog.append(element("h2", "", guide.trip.title), element("p", "", "公式しおり · 日付未定"), close);
    for (const day of guide.trip.timeline?.logicalDays ?? []) {
      dialog.append(element("h3", "", day.label ?? "旅の予定"));
      for (const item of guide.trip.items.filter(i => i.logicalDayId === day.id)) dialog.append(element("p", "", item.title));
    }
    const form = element("form"), start = element("input"), adults = element("input"), children = element("input");
    start.type = "date"; start.required = true; adults.type = children.type = "number"; adults.min = "1"; adults.max = "50"; children.min = "0"; children.max = "20"; adults.required = children.required = true; adults.value = "1"; children.value = "0";
    const party = element("div", "trip-library-party");
    for (const [name, input] of [["出発日（日本時間）", start], ["大人", adults], ["子ども", children]] as const) { const label = element("label", "", name); label.append(input); (input === start ? form : party).append(label); }
    form.append(party);
    const submit = element("button", "ds-button ds-button--primary", "このしおりで旅を作る"); submit.type = "submit"; form.append(submit); dialog.append(form, feedback);
    let busy = false; const id = crypto.randomUUID();
    form.addEventListener("submit", event => { event.preventDefault(); if (disposed || session !== options.session() || !options.authenticated() || busy || !form.reportValidity()) return; busy = true; submit.disabled = true; feedback.innerHTML = loadingMarkup("旅程を作っています。");
      void client.officialImport(guide, id, start.value, Number(adults.value), Number(children.value)).then(async trip => {
        if (session !== options.session() || !dialog.isConnected) return; notifySaved(document, "旅程を追加しました。"); await options.openTrip(trip.id); dialog.close(); dialog.remove();
      }).catch(() => { feedback.textContent = "旅程を作成・表示できませんでした。公開状態と入力を確認して再試行してください。"; }).finally(() => { busy = false; submit.disabled = false; });
    });
    dialogs.add(dialog); dialog.addEventListener("cancel", () => { dialog.remove(); dialogs.delete(dialog); });
    document.body.append(dialog); dialog.showModal(); close.focus();
  }
  for (const [key, label] of options.officialOnly ? [] : [["own", "あなたの旅"], ["shared", "共有中の旅"]]) {
    const button = control(label!, () => { selected = key!; paint(); if (!state().loaded && key !== "own") void load(); }); button.setAttribute("role", "tab"); button.id = `trip-library-tab-${key}`; button.setAttribute("aria-controls", key === "own" ? own.id : panel.id); buttons.set(key!, button); tabs.append(button);
    button.addEventListener("keydown", event => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); const list = [...buttons.values()], i = list.indexOf(button); const n = event.key === "Home" ? 0 : event.key === "End" ? list.length - 1 : (i + (event.key === "ArrowRight" ? 1 : list.length - 1)) % list.length; list[n]!.click(); list[n]!.focus(); });
  }
  if (!options.officialOnly) own.setAttribute("aria-labelledby", "trip-library-tab-own");
  paint(); if (options.officialOnly) void load();
  return { refresh() { if (epoch !== options.session() || !options.authenticated()) { epoch = options.session(); states.clear(); closeDialogs(); selected = initialCategory; paint(); } if (options.officialOnly && options.authenticated() && !state().loaded && !state().busy && !state().error) void load(); }, dispose() { disposed = true; closeDialogs(); tabs.remove(); panel.remove(); } };
}

function catalogueCard(id: string): HTMLElement {
  const card = element("article", "home-card trip-library-card");
  const cover = element("div", "trip-list-cover"), image = element("img"); image.src = tripCoverImage(id); image.alt = ""; image.loading = "lazy"; cover.setAttribute("aria-hidden", "true");
  cover.append(image, element("small", "", "旅のイメージ")); card.append(cover); return card;
}
