import { travelPreferenceLabels, type UserProfile } from "@raiquora/trip/travel-profile";
import type { ProfileUiController } from "../../usecases/personal-state/profile-ui-controller";
import type { ServerProfileState } from "../../usecases/personal-state/server-profile-client";

type Draft = Omit<UserProfile, "version" | "updatedAt">;
const profileSections = ["origin", "interests", "pace", "notes"] as const;
type Section = typeof profileSections[number];

/** Account-scoped Profile editor. Hidden legacy v2 fields remain in the draft and
 * round-trip unchanged; only retained everyday preferences are editable here. */
export function configureTravelProfile(document: Document, client: ProfileUiController): void {
  const page = document.querySelector<HTMLElement>("#travel-profile-page");
  if (!page) return;
  let read: ServerProfileState | undefined = client.current();
  let draft = read?.profile ? profileDraft(read.profile) : blankDraft();
  let dirty = false, composing = false, debounce: ReturnType<typeof setTimeout> | undefined;
  let editVersion = 0, lastSection: Section = "origin", rendered = false;

  const message = (text: string, state: "idle" | "pending" | "saving" | "saved" | "error" = "idle") => {
    const element = page.querySelector<HTMLElement>("[data-profile-message]");
    if (!element) return;
    element.textContent = text; element.dataset.state = state;
    const retry = page.querySelector<HTMLButtonElement>("[data-profile-retry]");
    if (retry) retry.hidden = state !== "error";
    page.querySelectorAll<HTMLElement>("[data-profile-section]").forEach((section) => {
      section.dataset.saveState = state === "error" && section.dataset.profileSection === lastSection ? "error" : "";
    });
  };
  const refreshSummaries = () => {
    for (const section of profileSections) {
      const summary = page.querySelector<HTMLElement>(`[data-profile-summary="${section}"]`);
      if (summary) summary.textContent = sectionSummary(section, draft);
    }
  };
  const syncDraft = (form: HTMLFormElement): boolean => {
    try { draft = readDraft(draft, new FormData(form)); refreshSummaries(); return true; }
    catch { message("入力内容を確認してください。", "error"); return false; }
  };
  const flush = () => {
    if (debounce) clearTimeout(debounce); debounce = undefined;
    const form = page.querySelector<HTMLFormElement>("form");
    if (!form || composing || !syncDraft(form) || !dirty) return;
    const version = editVersion;
    const profile: UserProfile = { ...structuredClone(draft), version: 2, updatedAt: new Date().toISOString() };
    message("保存中…", "saving");
    void client.autosave(profile).then((saved) => {
      read = saved;
      if (version !== editVersion) return;
      dirty = false;
      message("保存済み", "saved");
    }).catch(() => {
      if (version !== editVersion) return;
      dirty = true;
      message("保存できませんでした。入力は保持しています。", "error");
    });
  };
  const changed = (target: Element, immediate: boolean) => {
    const form = page.querySelector<HTMLFormElement>("form")!;
    if (!syncDraft(form)) return;
    lastSection = (target.closest<HTMLElement>("[data-profile-section]")?.dataset.profileSection as Section | undefined) ?? lastSection;
    dirty = true; editVersion += 1; message("未保存の変更", "pending");
    if (debounce) clearTimeout(debounce);
    if (immediate) flush(); else debounce = setTimeout(flush, 400);
  };
  const render = () => {
    page.innerHTML = `<section class="profile-editor"><header><div><h2>いつもの好み</h2><p>次の相談で参考にする任意設定です。今回の条件や保存済み旅程・予約は変えません。</p></div><div class="profile-save-status"><span role="status" aria-live="polite" data-profile-message></span><button type="button" data-profile-retry hidden>再試行</button></div></header>
      ${editor(draft)}
      <details class="profile-storage-actions"><summary>プロフィールの管理</summary><p>設定はアカウントに保存されます。削除すると普段の好み全体を削除します。</p><button type="button" data-delete ${!read?.profile ? "hidden" : ""}>プロフィールを削除</button></details></section>`;
    const form = page.querySelector<HTMLFormElement>("form")!;
    form.querySelectorAll<HTMLButtonElement>("[data-choice]").forEach((button) => button.addEventListener("click", () => {
      const name = button.dataset.choice!;
      const selected = button.dataset.toggle !== "true" || button.getAttribute("aria-pressed") !== "true";
      form.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value = selected ? button.dataset.value! : "";
      form.querySelectorAll<HTMLButtonElement>(`[data-choice="${name}"]`).forEach((choice) => choice.setAttribute("aria-pressed", String(choice === button && selected)));
      changed(button, true);
    }));
    form.addEventListener("compositionstart", () => { composing = true; });
    form.addEventListener("compositionend", (event) => { composing = false; changed(event.target as Element, false); });
    form.addEventListener("input", (event) => {
      const target = event.target;
      if (!composing && (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement && target.type === "text")) changed(target, false);
    });
    form.addEventListener("change", (event) => { if (!composing) changed(event.target as Element, true); });
    page.querySelector("[data-profile-retry]")?.addEventListener("click", flush);
    page.querySelector("[data-delete]")?.addEventListener("click", () => {
      const button = page.querySelector<HTMLButtonElement>("[data-delete]")!;
      if (button.dataset.confirm !== "yes") { button.dataset.confirm = "yes"; button.textContent = "削除を確定する"; return; }
      if (read?.revision === undefined) return;
      if (debounce) clearTimeout(debounce); debounce = undefined;
      void client.delete(read.revision).then(() => {
        read = undefined; draft = blankDraft(); dirty = false; editVersion += 1; render(); message("プロフィールを削除しました。", "saved");
      }).catch(() => message("削除できませんでした。時間をおいてもう一度お試しください。", "error"));
    });
    refreshSummaries(); rendered = true;
  };
  document.addEventListener("transitforge:profile-leave", () => flush());
  document.defaultView?.addEventListener("beforeunload", (event) => { if (dirty) { flush(); event.preventDefault(); event.returnValue = ""; } });
  client.subscribe(() => {
    const current = client.current();
    if (!rendered) { read = current; draft = current?.profile ? profileDraft(current.profile) : blankDraft(); render(); return; }
    if (!current) {
      if (debounce) clearTimeout(debounce); debounce = undefined;
      read = undefined; draft = blankDraft(); dirty = false; editVersion += 1; render(); return;
    }
    if (dirty) return;
    if (read?.revision !== current.revision) { read = current; draft = profileDraft(current.profile); render(); }
  });
  render();
}

function editor(draft: Draft): string {
  return `<form id="travel-profile-form"><p class="profile-scope-note">AI利用を選んだ好みだけを初期提案・比較の参考にします。今回の明示条件を常に優先します。</p>
    ${section("origin", "普段の出発地", sectionSummary("origin", draft), field("station", "駅・エリア", profileOrigin(draft)), true)}
    ${section("interests", "興味", sectionSummary("interests", draft), `<p>複数選べます。今回の会話で追加・訂正した興味は別に扱います。</p><div class="profile-chips">${Object.entries(travelPreferenceLabels).map(([key, label]) => {
      const value = draft.preferences[key as keyof typeof travelPreferenceLabels];
      return `<input type="hidden" name="interest-${key}" value="${value ?? ""}"><button type="button" data-choice="interest-${key}" data-value="0.9" data-toggle="true" aria-pressed="${value !== undefined && value >= .7}">${label}</button>`;
    }).join("")}</div>`)}
    ${section("pace", "ペース", sectionSummary("pace", draft), choice("pace", "1日の過ごし方", draft.travelStyle.pace, ["ゆっくり", "ほどほど", "しっかり"] ))}
    ${section("notes", "配慮してほしいこと", sectionSummary("notes", draft), `<div class="profile-field-grid">${note("lodging", "宿泊の好み", draft)}${note("food", "食事の好み", draft)}${note("avoidances", "避けたいこと", draft)}</div>`)}
    <p class="profile-consent-explanation">設定はアカウントに保存します。各メモの「AIの提案に使う」がOFFなら本文をAIへ送りません。プロフィール変更で既存の旅程・予約は更新しません。</p></form>`;
}
function section(key: Section, label: string, summary: string, body: string, open = false): string {
  return `<details class="profile-section" data-profile-section="${key}" ${open ? "open" : ""}><summary><span>${label}</span><small data-profile-summary="${key}">${esc(summary)}</small><span class="profile-section-state" aria-hidden="true"></span></summary><div class="profile-section-body">${body}</div></details>`;
}
function sectionSummary(section: Section, draft: Draft): string {
  if (section === "origin") return profileOrigin(draft) || "未設定";
  if (section === "interests") return (Object.entries(draft.preferences) as Array<[keyof typeof travelPreferenceLabels, number]>).filter(([, value]) => value >= .7).map(([key]) => travelPreferenceLabels[key]).join("・") || "未設定";
  if (section === "pace") return draft.travelStyle.pace === undefined ? "未設定" : draft.travelStyle.pace < .35 ? "ゆっくり" : draft.travelStyle.pace < .7 ? "ほどほど" : "しっかり";
  return [draft.notes?.lodging ? "宿泊" : undefined, draft.notes?.food ? "食事" : undefined, draft.notes?.avoidances ? "配慮事項" : undefined].filter(Boolean).join("・") || "未設定";
}
function profileOrigin(draft: Draft): string { return draft.home.station?.trim() || draft.home.area?.trim() || ""; }

function field(name: string, label: string, value = ""): string {
  return `<label>${label}<input name="${name}" type="text" value="${esc(value)}" maxlength="500"></label>`;
}
function choice(name: string, label: string, value: number | undefined, labels: string[]): string {
  const values = ["", "0.2", "0.5", "0.9"];
  const selected = value === undefined ? 0 : value < .35 ? 1 : value < .7 ? 2 : 3;
  return `<div class="profile-choice"><p>${label}</p><input type="hidden" name="${name}" value="${value ?? ""}"><div class="profile-chips" role="group" aria-label="${label}">${["未設定", ...labels].map((text, index) => `<button type="button" data-choice="${name}" data-value="${values[index]}" aria-pressed="${selected === index}">${text}</button>`).join("")}</div></div>`;
}
function note(key: "lodging" | "food" | "avoidances", label: string, draft: Draft): string {
  return `<div><label>${label}<textarea name="${key}" maxlength="500" rows="2">${esc(draft.notes?.[key] ?? "")}</textarea></label><label class="profile-note-consent"><input type="checkbox" name="ai-note" value="${key}" ${draft.aiNoteFields?.includes(key) ? "checked" : ""}>AIの提案に使う</label></div>`;
}
function blankDraft(): Draft { return { home: {}, companions: { usual: [], children: [] }, travelStyle: {}, preferences: {}, transport: {} }; }
function profileDraft(profile: UserProfile): Draft { const { version: _, updatedAt: __, ...draft } = structuredClone(profile); return draft; }
function readDraft(previous: Draft, data: FormData): Draft {
  const draft = structuredClone(previous), text = (key: string) => String(data.get(key) ?? "").trim();
  // Preserve the two legacy origin fields unless the visible origin was edited.
  // An explicit clear must also remove the hidden area fallback.
  if (text("station") !== profileOrigin(previous)) {
    draft.home.station = text("station") || undefined;
    draft.home.area = undefined;
  }
  if (text("pace")) draft.travelStyle.pace = Number(text("pace")); else delete draft.travelStyle.pace;
  // Hidden old mobility/tolerance, party and budget fields round-trip unchanged.
  for (const key of Object.keys(travelPreferenceLabels) as Array<keyof typeof travelPreferenceLabels>) {
    if (text(`interest-${key}`)) draft.preferences[key] = Number(text(`interest-${key}`)); else delete draft.preferences[key];
  }
  for (const key of ["lodging", "food", "avoidances"] as const) {
    if (text(key)) (draft.notes ??= {})[key] = text(key); else if (draft.notes) delete draft.notes[key];
  }
  const retainedBudgetConsent = previous.aiNoteFields?.includes("budget") ? ["budget" as const] : [];
  const aiNoteFields = [...retainedBudgetConsent, ...(data.getAll("ai-note") as Array<"lodging" | "food" | "avoidances">)];
  if (aiNoteFields.length) draft.aiNoteFields = aiNoteFields; else delete draft.aiNoteFields;
  return draft;
}
export function profileIntroductionGreeting(date = new Date()): string { const hour = date.getHours(); return hour >= 18 || hour < 5 ? "こんばんは" : "こんにちは"; }
function esc(value: string): string { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
