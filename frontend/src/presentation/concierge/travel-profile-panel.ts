import { travelPreferenceLabels, type TravelPreference, type UserProfile } from "@raiquora/trip/travel-profile";
import type { ProfileUiController } from "../../usecases/personal-state/profile-ui-controller";
import type { ServerProfileState } from "../../usecases/personal-state/server-profile-client";

interface Draft { usualOrigin: string; interests: TravelPreference[]; considerations: string }

/** Three optional account-level defaults. Trip conditions are deliberately absent. */
export function configureTravelProfile(document: Document, client: ProfileUiController): void {
  const page = document.querySelector<HTMLElement>("#travel-profile-page");
  if (!page) return;
  let read = client.current(), draft = fromProfile(read?.profile), dirty = false, composing = false;
  let timer: ReturnType<typeof setTimeout> | undefined, generation = 0;

  const status = (text: string, state = "") => {
    const el = page.querySelector<HTMLElement>("[data-profile-message]"); if (!el) return;
    el.textContent = text; el.dataset.state = state;
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
    page.innerHTML = `<section class="profile-editor"><header><div><h2>いつもの好み</h2><p>毎回説明しなくてよいことだけ。すべて任意で、今回の旅の条件が常に優先されます。</p></div><div class="profile-save-status"><span role="status" aria-live="polite" data-profile-message></span><button type="button" data-profile-retry hidden>再試行</button></div></header>
      <form id="travel-profile-form">
        <label>普段の出発地<input name="usualOrigin" type="text" maxlength="200" value="${esc(draft.usualOrigin)}" placeholder="例：大阪駅、神戸市"></label>
        <fieldset><legend>好きなこと</legend><p>旅先を探すときの参考にします。</p><div class="profile-chips">${Object.entries(travelPreferenceLabels).map(([key,label]) => `<label><input type="checkbox" name="interest" value="${key}" ${draft.interests.includes(key as TravelPreference) ? "checked" : ""}><span>${label}</span></label>`).join("")}</div></fieldset>
        <label>いつも配慮してほしいこと<textarea name="considerations" maxlength="1000" rows="4" placeholder="例：歩きすぎない、地元の料理を楽しみたい、静かな宿が好き">${esc(draft.considerations)}</textarea></label>
        <p class="profile-consent-explanation">この3項目は提案の参考としてAIへ渡します。日程・人数・予算など今回の条件は旅程側で扱い、ここへ自動保存しません。</p>
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
  document.defaultView?.addEventListener("beforeunload", (event) => { if (dirty) { flush(); event.preventDefault(); event.returnValue = ""; } });
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
