import { travelPreferenceLabels, type UserProfile } from "@raiquora/trip/travel-profile";
import type { ProfileUiController } from "../../usecases/personal-state/profile-ui-controller";
import type { ServerProfileState } from "../../usecases/personal-state/server-profile-client";

type Draft = Omit<UserProfile, "version" | "updatedAt">;
const styles: Array<[keyof UserProfile["travelStyle"], string]> = [
  ["pace", "ペース（ゆっくり → 活発）"], ["novelty", "行き先（定番 → 新しい場所）"],
  ["crowdTolerance", "混雑の許容度"], ["walkingTolerance", "歩行の許容度"], ["transferTolerance", "乗換の許容度"],
  ["earlyMorningTolerance", "早朝出発の許容度"], ["lateNightTolerance", "夜遅い到着の許容度"],
  ["drivingTolerance", "運転の許容度"], ["busTolerance", "バス移動の許容度"],
];
const companions = { solo: "一人", partner: "パートナー", friends: "友人", children: "子ども", family: "家族" };

/** Profile is account-scoped server state. It deliberately has no browser-storage fallback. */
export function configureTravelProfile(document: Document, client: ProfileUiController): void {
  const page = document.querySelector<HTMLElement>("#travel-profile-page");
  if (!page) return;
  let read: ServerProfileState | undefined = client.current();
  let draft = read?.profile ? profileDraft(read.profile) : blankDraft(), dirty = false;
  const message = (text: string) => { page.querySelector<HTMLElement>("[data-profile-message]")!.textContent = text; };
  const warnUnsaved = () => {
    message("変更はまだ保存されていません。保存するか、変更を破棄してから移動してください。");
    page.querySelector<HTMLElement>("[data-discard]")!.hidden = false;
  };
  const render = () => {
    page.innerHTML = `<section class="profile-editor"><header><div><h2>旅行プロフィール</h2><p>普段の好みを、次の旅のヒントに。今回の旅の条件を優先します。</p></div></header>
      <p role="status" aria-live="polite" data-profile-message></p>${editor(draft)}
      <details class="profile-storage-actions"><summary>プロフィールの管理</summary><button type="button" data-delete ${!read?.profile ? "hidden" : ""}>プロフィールを削除</button></details>
      <div class="profile-editor-actions"><button type="button" data-discard hidden>変更を破棄</button><button type="submit" form="travel-profile-form">保存する</button></div></section>`;
    page.querySelector("[data-discard]")?.addEventListener("click", () => {
      draft = read?.profile ? profileDraft(read.profile) : blankDraft(); dirty = false; render(); message("変更を破棄しました。");
    });
    page.querySelector("[data-delete]")?.addEventListener("click", () => {
      const button = page.querySelector<HTMLButtonElement>("[data-delete]")!;
      if (button.dataset.confirm !== "yes") { button.dataset.confirm = "yes"; button.textContent = "削除を確定する"; return; }
      if (read?.revision === undefined) return;
      void client.delete(read.revision).then(() => {
        read = undefined; draft = blankDraft(); dirty = false; render(); message("プロフィールを削除しました。");
      }).catch(() => message("削除できませんでした。時間をおいてもう一度お試しください。"));
    });
    const form = page.querySelector<HTMLFormElement>("form")!;
    form.querySelectorAll<HTMLButtonElement>("[data-choice]").forEach((button) => button.addEventListener("click", () => {
      const name = button.dataset.choice!;
      const selected = button.dataset.toggle !== "true" || button.getAttribute("aria-pressed") !== "true";
      form.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value = selected ? button.dataset.value! : "";
      form.querySelectorAll<HTMLButtonElement>(`[data-choice="${name}"]`).forEach((choice) => choice.setAttribute("aria-pressed", String(choice === button && selected)));
      dirty = true;
    }));
    form.addEventListener("input", () => { dirty = true; });
    form.addEventListener("change", () => { dirty = true; });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      try {
        draft = readDraft(draft, new FormData(form));
        const profile: UserProfile = { ...draft, version: 2, updatedAt: new Date().toISOString() };
        void client.update(profile, read?.revision ?? null).then((saved) => {
          read = saved; draft = profileDraft(saved.profile); dirty = false; render();
          message("プロフィールを保存しました。次の相談から普段の好みとして参照します。");
        }).catch(() => message("保存できませんでした。入力はこの画面に残しています。時間をおいてもう一度お試しください。"));
      } catch { message("入力を確認してください。"); }
    });
  };
  document.addEventListener("transitforge:profile-leave", (event) => { if (dirty) { event.preventDefault(); warnUnsaved(); } });
  document.defaultView?.addEventListener("beforeunload", (event) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });
  client.subscribe(() => {
    const saved = client.current();
    if (dirty && saved) return;
    read = saved; draft = saved ? profileDraft(saved.profile) : blankDraft(); dirty = false; render();
  });
  render();
}

function editor(draft: Draft): string {
  return `<form id="travel-profile-form"><p class="profile-scope-note">普段の好みを保存します。今回の旅の条件を優先し、旅程や予約は変更しません。</p><fieldset><legend>基本情報</legend><div class="profile-field-grid">${field("station", "普段の出発駅", draft.home.station)}
    ${field("party", "普段の人数（今回の人数ではありません）", draft.companions.usualPartySize?.toString(), "number")}
    <label>優先する移動手段<select name="mode">${Object.entries({ "": "未設定", rail: "鉄道", car: "車", bus: "バス", walking: "徒歩" }).map(([key, label]) => `<option value="${key}" ${key === (draft.transport.preferredMode ?? "") ? "selected" : ""}>${label}</option>`).join("")}</select></label>
    ${note("budget", "普段の予算感", draft)}</div><details><summary>出発地・同行者の詳細</summary>${field("area", "普段の出発エリア", draft.home.area)}
    <label>車の利用<select name="car"><option value="" ${draft.home.carAvailable === undefined ? "selected" : ""}>未設定</option><option value="yes" ${draft.home.carAvailable === true ? "selected" : ""}>使える</option><option value="no" ${draft.home.carAvailable === false ? "selected" : ""}>使わない</option></select></label>
    <p>よく一緒に出かける人</p><div class="profile-chips">${Object.entries(companions).map(([key, label]) => `<label><input type="checkbox" name="companion" value="${key}" ${draft.companions.usual.includes(key as keyof typeof companions) ? "checked" : ""}>${label}</label>`).join("")}</div></details></fieldset>
    <fieldset><legend>旅のペース</legend><p>無理なく楽しめる、いつもの過ごし方を教えてください。</p>
    ${choice("earlyMorningTolerance", "朝のスタート", draft.travelStyle.earlyMorningTolerance, ["ゆっくり", "どちらでも", "早朝から動ける"])}
    ${choice("pace", "1日の詰め込み度", draft.travelStyle.pace, ["ゆったり", "バランス", "いろいろ巡りたい"])}
    ${choice("transferTolerance", "乗換の好み", draft.travelStyle.transferTolerance, ["少なめ", "バランス", "乗換も楽しめる"])}</fieldset>
    <fieldset><legend>興味・目的</legend><p>気になるものを選んでください。今までの細かな好みは、触れた項目だけ変更します。</p><div class="profile-chips">${Object.entries(travelPreferenceLabels).map(([key, label]) => {
      const value = draft.preferences[key as keyof typeof travelPreferenceLabels];
      return `<input type="hidden" name="interest-${key}" value="${value ?? ""}"><button type="button" data-choice="interest-${key}" data-value="0.9" data-toggle="true" aria-pressed="${value !== undefined && value >= .7}">${label}</button>`;
    }).join("")}</div></fieldset>
    <fieldset><legend>宿泊・食事</legend><div class="profile-field-grid">${note("lodging", "宿泊の好み", draft)}${note("food", "食事の好み", draft)}</div></fieldset>
    <fieldset><legend>配慮事項</legend>${note("avoidances", "避けたいこと・配慮してほしいこと", draft)}
    <details><summary>移動・過ごし方の詳細設定</summary>${field("minutes", "普段の移動上限（分・空欄は未設定）", draft.transport.maxTypicalTravelMinutes?.toString(), "number")}
    ${styles.filter(([key]) => !["earlyMorningTolerance", "pace", "transferTolerance"].includes(key)).map(([key, label]) => choice(key, label, draft.travelStyle[key], ["控えめ", "ほどほど", "多めでも大丈夫"])).join("")}<p>保存済みの子どもの年代は維持します。今回の人数・年齢は旅行ごとに確認します。</p></details></fieldset>
    <p class="profile-consent-explanation">「AIの提案に使う」を選んで保存したメモは、項目ごとに先頭240文字までAIへ送信します。未選択のメモはこの端末だけに保存し、メモ本文はログへ記録しません。</p></form>`;
}
function field(name: string, label: string, value = "", type = "text"): string {
  const range = name === "party" ? 'min="1" max="100" step="1"' : 'min="0" max="1440" step="1"';
  return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${type === "number" ? range : 'maxlength="500"'}></label>`;
}
function choice(name: string, label: string, value: number | undefined, labels: string[]): string {
  const values = ["", "0.2", "0.5", "0.9"];
  const selected = value === undefined ? 0 : value < .35 ? 1 : value < .7 ? 2 : 3;
  return `<div class="profile-choice"><p>${label}</p><input type="hidden" name="${name}" value="${value ?? ""}"><div class="profile-chips" role="group" aria-label="${label}">${["未設定", ...labels].map((text, index) => `<button type="button" data-choice="${name}" data-value="${values[index]}" aria-pressed="${selected === index}">${text}</button>`).join("")}</div></div>`;
}
function note(key: "budget" | "lodging" | "food" | "avoidances", label: string, draft: Draft): string {
  return `<div><label>${label}<textarea name="${key}" maxlength="500" rows="${key === "budget" ? 1 : 2}">${esc(draft.notes?.[key] ?? "")}</textarea></label><label class="profile-note-consent"><input type="checkbox" name="ai-note" value="${key}" ${draft.aiNoteFields?.includes(key) ? "checked" : ""}>AIの提案に使う</label></div>`;
}
function blankDraft(): Draft { return { home: {}, companions: { usual: [], children: [] }, travelStyle: {}, preferences: {}, transport: {} }; }
function profileDraft(profile: UserProfile): Draft { const { version: _, updatedAt: __, ...draft } = structuredClone(profile); return draft; }
function readDraft(previous: Draft, data: FormData): Draft {
  const draft = structuredClone(previous);
  const text = (key: string) => String(data.get(key) ?? "").trim();
  draft.home.station = text("station") || undefined; draft.home.area = text("area") || undefined;
  draft.home.carAvailable = text("car") === "" ? undefined : text("car") === "yes";
  draft.companions.usual = data.getAll("companion") as UserProfile["companions"]["usual"];
  draft.companions.usualPartySize = text("party") ? Number(text("party")) : undefined;
  for (const [key] of styles) { if (text(key)) draft.travelStyle[key] = Number(data.get(key)); else delete draft.travelStyle[key]; }
  for (const key of Object.keys(travelPreferenceLabels) as Array<keyof typeof travelPreferenceLabels>) {
    if (text(`interest-${key}`)) draft.preferences[key] = Number(data.get(`interest-${key}`)); else delete draft.preferences[key];
  }
  draft.transport.maxTypicalTravelMinutes = text("minutes") ? Number(text("minutes")) : previous.transport.maxTypicalTravelMinutes === null ? null : undefined;
  draft.transport.preferredMode = (text("mode") || undefined) as UserProfile["transport"]["preferredMode"];
  for (const key of ["budget", "lodging", "food", "avoidances"] as const) {
    if (text(key)) (draft.notes ??= {})[key] = text(key); else if (draft.notes) delete draft.notes[key];
  }
  const aiNoteFields = data.getAll("ai-note") as NonNullable<UserProfile["aiNoteFields"]>;
  if (aiNoteFields.length) draft.aiNoteFields = aiNoteFields; else delete draft.aiNoteFields;
  return draft;
}
export function profileIntroductionGreeting(date = new Date()): string { const hour = date.getHours(); return hour >= 18 || hour < 5 ? "こんばんは" : "こんにちは"; }
function esc(value: string): string { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
