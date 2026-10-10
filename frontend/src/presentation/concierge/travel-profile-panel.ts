import { setLoadingStatus } from "../shared/primitives";
import { travelPreferenceLabels, type TravelPreference, type UserProfile } from "@raiquora/trip/travel-profile";
import type { ProfileUiController } from "../../usecases/personal-state/profile-ui-controller";

interface Draft { usualOrigin: string; interests: TravelPreference[]; considerations: string }

/** Three optional account-level defaults. Trip conditions are deliberately absent. */
export function configureTravelProfile(document: Document, client: ProfileUiController): void {
  const page = document.querySelector<HTMLElement>("#travel-profile-page");
  if (!page) return;
  let read = client.current(), draft = fromProfile(read?.profile), dirty = false, composing = false;
  let timer: ReturnType<typeof setTimeout> | undefined, generation = 0;

  const status = (text: string, state = "") => {
    const el = page.querySelector<HTMLElement>("[data-profile-message]"); if (!el) return;
    setLoadingStatus(el, text, state === "loading" || state === "saving"); el.dataset.state = state;
    const retry = page.querySelector<HTMLButtonElement>("[data-profile-retry]"); if (retry) retry.hidden = state !== "error";
  };
  const readForm = (): Draft => {
    const form = page.querySelector<HTMLFormElement>("form")!, data = new FormData(form);
    return {
      usualOrigin: String(data.get("usualOrigin") ?? "").trim(),
      interests: data.getAll("interest").map(String).filter((v): v is TravelPreference => Object.hasOwn(travelPreferenceLabels, v)),
      considerations: String(data.get("considerations") ?? "").trim(),
    };
  };
  const flush = () => {
    if (timer) clearTimeout(timer); timer = undefined;
    if (composing || !dirty) return;
    draft = readForm(); const own = generation;
    const profile: UserProfile = {
      version: 3, interests: [...new Set(draft.interests)], updatedAt: new Date().toISOString(),
      ...(draft.usualOrigin ? { usualOrigin: draft.usualOrigin } : {}),
      ...(draft.considerations ? { considerations: draft.considerations } : {}),
    };
    status("保存中…", "saving");
    void client.autosave(profile).then((saved) => {
      read = saved; if (own !== generation) return; dirty = false; status("保存済み", "saved");
    }).catch(() => { if (own === generation) { dirty = true; status("保存できませんでした。入力は保持しています。", "error"); } });
  };
  const changed = (immediate = false) => {
    draft = readForm(); dirty = true; generation++; status("未保存の変更", "pending");
    if (timer) clearTimeout(timer);
    if (immediate) flush(); else timer = setTimeout(flush, 400);
  };
  const render = () => {
    page.innerHTML = `<section class="profile-editor"><header><div><h2>いつもの好み</h2><p>すべて任意です。今回の旅の条件を優先します。</p></div><div class="profile-save-status"><span role="status" aria-live="polite" data-profile-message></span><button type="button" data-profile-retry hidden>再試行</button></div></header>
      <form id="travel-profile-form">
        <label>普段の出発地<input name="usualOrigin" type="text" maxlength="200" value="${esc(draft.usualOrigin)}" placeholder="例：大阪駅、神戸市"></label>
        <fieldset><legend>好きなこと</legend><div class="profile-chips">${Object.entries(travelPreferenceLabels).map(([key,label]) => `<label><input type="checkbox" name="interest" value="${key}" ${draft.interests.includes(key as TravelPreference) ? "checked" : ""}><span>${interestIcon(key as TravelPreference)}${label}</span></label>`).join("")}</div></fieldset>
        <label>いつも配慮してほしいこと<textarea name="considerations" maxlength="1000" rows="4" placeholder="例：歩きすぎない、地元の料理を楽しみたい、静かな宿が好き">${esc(draft.considerations)}</textarea></label>
      </form>
      <details class="profile-storage-actions"><summary>プロフィールの管理</summary><p>設定はアカウントに保存されます。</p><button type="button" data-delete ${!read?.profile ? "hidden" : ""}>プロフィールを削除</button></details></section>`;
    const form = page.querySelector<HTMLFormElement>("form")!;
    form.addEventListener("compositionstart", () => { composing = true; });
    form.addEventListener("compositionend", () => { composing = false; changed(false); });
    form.addEventListener("input", (event) => { if (!composing) changed((event.target as HTMLInputElement).type === "checkbox"); });
    page.querySelector("[data-profile-retry]")?.addEventListener("click", flush);
    page.querySelector("[data-delete]")?.addEventListener("click", () => {
      const button = page.querySelector<HTMLButtonElement>("[data-delete]")!;
      if (button.dataset.confirm !== "yes") { button.dataset.confirm = "yes"; button.textContent = "削除を確定する"; return; }
      if (read?.revision === undefined) return;
      void client.delete(read.revision).then(() => { read = undefined; draft = emptyDraft(); dirty = false; generation++; render(); status("プロフィールを削除しました。", "saved"); })
        .catch(() => status("削除できませんでした。", "error"));
    });
  };
  document.addEventListener("transitforge:profile-leave", flush);
  document.defaultView?.addEventListener("beforeunload", () => { if (dirty) flush(); });
  client.subscribe(() => {
    const current = client.current();
    if (dirty) return;
    if (current?.revision !== read?.revision || Boolean(current) !== Boolean(read)) { read = current; draft = fromProfile(current?.profile); render(); }
  });
  render();
}
function emptyDraft(): Draft { return { usualOrigin: "", interests: [], considerations: "" }; }
function fromProfile(profile?: UserProfile): Draft {
  return profile ? { usualOrigin: profile.usualOrigin ?? "", interests: [...profile.interests], considerations: profile.considerations ?? "" } : emptyDraft();
}
export function profileIntroductionGreeting(date = new Date()): string { const hour = date.getHours(); return hour >= 18 || hour < 5 ? "こんばんは" : "こんにちは"; }
function esc(value: string): string { return value.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;"); }

function interestIcon(key: TravelPreference): string {
  const paths: Record<TravelPreference, string> = {
    sea: '<path d="M3 8q3-4 6 0t6 0t6 0M3 14q3-4 6 0t6 0t6 0M3 20q3-4 6 0t6 0t6 0"/>',
    mountain: '<path d="m2 20 8-16 5 10 3-5 4 11ZM7 10l3 3 3-3"/>',
    nature: '<path d="M19 3C7 3 3 9 5 15c5 5 14 1 14-12ZM5 20l9-10"/>',
    onsen: '<path d="M3 15c0 8 18 8 18 0M7 3c-5 4 5 5 0 9M12 2c-5 4 5 5 0 9M17 3c-5 4 5 5 0 9"/>',
    food: '<path d="M4 3v6c0 4 6 4 6 0V3M7 3v18M19 21V3c-5 1-5 10 0 10"/>',
    railway: '<rect x="5" y="3" width="14" height="15" rx="3"/><path d="M5 10h14M8 21l2-3M16 21l-2-3"/>',
    history: '<path d="m3 8 9-5 9 5ZM3 21h18M5 10v8M10 10v8M15 10v8M20 10v8"/>',
    cityWalk: '<path d="M3 21V8h6v13M9 21V3h6v18M15 21V11h6v10M6 11v2M12 7v2M18 14v2"/>',
    animals: '<ellipse cx="12" cy="16" rx="5" ry="4"/><ellipse cx="4" cy="9" rx="2" ry="3"/><ellipse cx="9" cy="5" rx="2" ry="3"/><ellipse cx="15" cy="5" rx="2" ry="3"/><ellipse cx="20" cy="9" rx="2" ry="3"/>',
    art: '<path d="M12 3C0 3 0 21 12 21c4 0 1-5 4-5 8 0 7-13-4-13Z"/><circle cx="7" cy="9" r="1"/><circle cx="12" cy="6" r="1"/><circle cx="17" cy="9" r="1"/>',
    themePark: '<circle cx="12" cy="10" r="7"/><path d="M12 3v14M5 10h14M7 5l10 10M17 5 7 15M12 10l-5 11M12 10l5 11M5 21h14"/>',
    shopping: '<path d="M4 8h16l1 13H3ZM8 8V6a4 4 0 0 1 8 0v2"/>'
  };
  return `<svg class="ds-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[key]}</svg>`;
}
