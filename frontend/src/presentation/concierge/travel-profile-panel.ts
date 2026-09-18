import { travelPreferenceLabels, travelStyleSummary, type UserProfile } from "@raiquora/trip/travel-profile";
import { deleteUserProfile, readUserProfile, saveUserProfile, travelProfileChangedEvent } from "../../usecases/trip-profile/user-profile-repository";

type Draft = Omit<UserProfile, "version" | "updatedAt">;
const styles: Array<[keyof UserProfile["travelStyle"], string]> = [
  ["pace", "ペース（ゆっくり → 活発）"], ["novelty", "行き先（定番 → 新しい場所）"],
  ["crowdTolerance", "混雑の許容度"], ["walkingTolerance", "歩行の許容度"], ["transferTolerance", "乗換の許容度"],
  ["earlyMorningTolerance", "早朝出発の許容度"], ["lateNightTolerance", "夜遅い到着の許容度"],
  ["drivingTolerance", "運転の許容度"], ["busTolerance", "バス移動の許容度"],
];
const companions = { solo: "一人", partner: "パートナー", friends: "友人", children: "子ども", family: "家族" };

/** Existing local Profile editor; no Trip source or mutation dependency. */
export function configureTravelProfile(document: Document, storage: Storage, onProfileCompleted: () => void = () => undefined): void {
  const dialog = document.querySelector<HTMLDialogElement>("#travel-profile-dialog");
  const toggle = document.querySelector<HTMLButtonElement>("#travel-profile-toggle");
  if (!dialog || !toggle) return;
  let draft = blankDraft(), editing = false, dirty = false;
  let read = readUserProfile(storage);
  const notify = () => document.dispatchEvent(new Event(travelProfileChangedEvent));
  const message = (text: string) => { dialog.querySelector<HTMLElement>("[data-profile-message]")!.textContent = text; };
  const close = () => {
    if (!dirty) { dialog.close(); return; }
    message("変更はまだ保存されていません。編集を続けるか、破棄して閉じてください。");
    dialog.querySelector<HTMLElement>("[data-discard]")!.hidden = false;
  };
  const render = () => {
    dialog.innerHTML = `<section class="profile-editor"><header><h2>旅行プロフィール</h2><button type="button" data-close aria-label="閉じる">×</button></header>
      <p>この端末の普段の好みです。今回の旅の条件を優先し、保存済みの旅程や予約は変更しません。</p>
      <p role="status" aria-live="polite" data-profile-message></p>
      ${editing ? editor(draft) : `<p>${read.profile ? esc(travelStyleSummary(read.profile)) : "まだ登録していません。設定せずに相談できます。"}</p>
      <button type="button" data-edit>旅行プロフィールを編集</button><button type="button" data-start>相談する</button>`}
      <div class="profile-editor-actions"><button type="button" data-close>${editing ? "取消" : "閉じる"}</button>
      <button type="button" data-discard hidden>変更を破棄して閉じる</button>
      <button type="button" data-delete ${read.status === "empty" ? "hidden" : ""}>この端末のプロフィールを削除</button></div></section>`;
    if (read.status === "invalid") message("保存データを読み取れません。原本は残しています。自動上書きはしません。削除してから新しく設定できます。");
    if (read.status === "unavailable") message("この端末の保存領域を利用できません。プロフィールなしで相談できます。");
    dialog.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", close));
    dialog.querySelector("[data-discard]")?.addEventListener("click", () => { dirty = false; dialog.close(); });
    dialog.querySelector("[data-edit]")?.addEventListener("click", () => { editing = true; render(); });
    dialog.querySelector("[data-start]")?.addEventListener("click", () => { dialog.close(); onProfileCompleted(); });
    dialog.querySelector("[data-delete]")?.addEventListener("click", () => {
      const button = dialog.querySelector<HTMLButtonElement>("[data-delete]")!;
      if (button.dataset.confirm !== "yes") { button.dataset.confirm = "yes"; button.textContent = "削除を確定する"; return; }
      try { deleteUserProfile(storage); notify(); read = readUserProfile(storage); draft = blankDraft(); dirty = false; editing = false; render(); }
      catch { message("削除できませんでした。保存データは変更していません。"); }
    });
    const form = dialog.querySelector<HTMLFormElement>("form");
    form?.addEventListener("input", () => { dirty = true; });
    form?.addEventListener("change", () => {
      dirty = true;
      for (const input of form.querySelectorAll<HTMLInputElement>("[data-enable]")) {
        form.querySelector<HTMLInputElement>(`[name="${input.dataset.enable}"]`)!.disabled = !input.checked;
      }
    });
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (read.status === "invalid" || read.status === "unavailable") { message("原本の上書きを避けるため保存していません。端末の保存状態を確認してください。"); return; }
      try {
        draft = readDraft(draft, new FormData(form));
        saveUserProfile(storage, draft); notify(); read = readUserProfile(storage); dirty = false; editing = false; render();
        message("この端末に保存しました。次の相談から普段の好みとして参照します。");
      } catch { message("保存できませんでした。入力はこの画面に残しています。端末の空き容量や入力値を確認してください。"); }
    });
  };
  dialog.addEventListener("cancel", (event) => { if (dirty) { event.preventDefault(); close(); } });
  document.defaultView?.addEventListener("beforeunload", (event) => { if (dirty && dialog.open) { event.preventDefault(); event.returnValue = ""; } });
  toggle.addEventListener("click", () => {
    if (dialog.open) return;
    read = readUserProfile(storage); draft = read.profile ? profileDraft(read.profile) : blankDraft(); dirty = false; editing = false;
    render(); dialog.showModal();
  });
  // Registration is optional. Never open a blocking onboarding dialog on startup.
}

function editor(draft: Draft): string {
  return `<form><fieldset><legend>基本情報</legend>${field("station", "普段の出発駅", draft.home.station)}${field("area", "普段の出発エリア", draft.home.area)}
    <label>車の利用<select name="car"><option value="" ${draft.home.carAvailable === undefined ? "selected" : ""}>未設定</option><option value="yes" ${draft.home.carAvailable === true ? "selected" : ""}>使える</option><option value="no" ${draft.home.carAvailable === false ? "selected" : ""}>使わない</option></select></label>
    <div class="profile-chips">${Object.entries(companions).map(([key, label]) => `<label><input type="checkbox" name="companion" value="${key}" ${draft.companions.usual.includes(key as keyof typeof companions) ? "checked" : ""}>${label}</label>`).join("")}</div>
    ${field("party", "普段の人数（今回の人数ではありません）", draft.companions.usualPartySize?.toString(), "number")}
    <p>保存済みの子どもの年代は維持します。今回の人数・年齢は旅行ごとに確認します。</p></fieldset>
    <fieldset><legend>ペース・配慮事項</legend><p>設定する項目だけチェックしてください。0は低め、1は高めです。</p>
    ${styles.map(([key, label]) => range(key, label, draft.travelStyle[key])).join("")}</fieldset>
    <fieldset><legend>興味</legend>${Object.entries(travelPreferenceLabels).map(([key, label]) => range(`interest-${key}`, label, draft.preferences[key as keyof typeof travelPreferenceLabels])).join("")}</fieldset>
    <fieldset><legend>移動・宿泊・食事</legend>${field("minutes", "普段の移動上限（分・空欄は未設定）", draft.transport.maxTypicalTravelMinutes?.toString(), "number")}
    <label>優先する移動手段<select name="mode">${Object.entries({ "": "未設定", rail: "鉄道", car: "車", bus: "バス", walking: "徒歩" }).map(([key, label]) => `<option value="${key}" ${key === (draft.transport.preferredMode ?? "") ? "selected" : ""}>${label}</option>`).join("")}</select></label>
    ${([ ["budget", "普段の予算感"], ["lodging", "宿泊の好み"], ["food", "食事の好み"], ["avoidances", "避けたいこと・配慮事項"] ] as const).map(([key, label]) => `<label>${label}<textarea name="${key}" maxlength="500" rows="2">${esc(draft.notes?.[key] ?? "")}</textarea></label>`).join("")}
    <small>宿泊・食事などの自由記述は端末内のメモです。相談で使いたい内容は送信時に伝えてください。必要のない個人情報は入力しないでください。</small></fieldset>
    <button type="submit">この端末に保存</button></form>`;
}
function field(name: string, label: string, value = "", type = "text"): string {
  return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${type === "number" ? 'min="0" max="1440"' : 'maxlength="500"'}></label>`;
}
function range(name: string, label: string, value?: number): string {
  return `<div class="profile-range"><label><input type="checkbox" data-enable="${name}" ${value === undefined ? "" : "checked"}>${label}を設定</label>
    <input aria-label="${label}" name="${name}" type="range" min="0" max="1" step="any" value="${value ?? .5}" ${value === undefined ? "disabled" : ""}></div>`;
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
  for (const [key] of styles) { if (data.has(key)) draft.travelStyle[key] = Number(data.get(key)); else delete draft.travelStyle[key]; }
  for (const key of Object.keys(travelPreferenceLabels) as Array<keyof typeof travelPreferenceLabels>) {
    if (data.has(`interest-${key}`)) draft.preferences[key] = Number(data.get(`interest-${key}`)); else delete draft.preferences[key];
  }
  draft.transport.maxTypicalTravelMinutes = text("minutes") ? Number(text("minutes")) : previous.transport.maxTypicalTravelMinutes === null ? null : undefined;
  draft.transport.preferredMode = (text("mode") || undefined) as UserProfile["transport"]["preferredMode"];
  for (const key of ["budget", "lodging", "food", "avoidances"] as const) {
    if (text(key)) (draft.notes ??= {})[key] = text(key); else if (draft.notes) delete draft.notes[key];
  }
  return draft;
}
export function profileIntroductionGreeting(date = new Date()): string { const hour = date.getHours(); return hour >= 18 || hour < 5 ? "こんばんは" : "こんにちは"; }
function esc(value: string): string { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
