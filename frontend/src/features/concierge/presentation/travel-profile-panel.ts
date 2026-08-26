import { travelPreferenceLabels, travelStyleSummary, type ChildAgeGroup, type TravelCompanion, type TravelPreference, type UserProfile } from "@raiquora/trip/travel-profile";
import {
  deleteUserProfile,
  loadUserProfile,
  saveUserProfile,
  travelProfileChangedEvent,
} from "../../../application/trip-profile/user-profile-repository";
import { selectConciergeForUserProfile, type ConciergeProfile } from "..";

const companionOptions: Array<[TravelCompanion, string]> = [["solo", "一人"], ["partner", "パートナー"], ["friends", "友人"], ["children", "子どもと一緒"], ["family", "家族"]];
const ageGroups: Array<[ChildAgeGroup, string]> = [["baby", "0〜2歳"], ["preschool", "3〜5歳"], ["elementary", "小学生"], ["teen", "中学生以上"]];
const avoidances = ["混雑", "長時間歩く", "何度も乗り換える", "朝早い", "夜遅い", "車の運転", "バス移動", "特になし"];
const preferenceKeys = Object.keys(travelPreferenceLabels) as TravelPreference[];
const travelTimes: Array<[number | "any", string]> = [[60, "1時間くらい"], [120, "2時間くらい"], [180, "3時間くらい"], [240, "4時間くらい"], ["any", "遠ければ遠いほど旅行感があって好き"]];
const icons: Record<TravelPreference, string> = { sea: "🌊", mountain: "⛰", nature: "🌲", onsen: "♨️", food: "🍴", railway: "🚃", history: "🏯", cityWalk: "🏙", animals: "🐘", art: "🎨", themePark: "🎡", shopping: "🛍" };
const titles = ["出発地", "同行者", "旅行ペース", "好きなもの", "旅の好み", "移動時間", "避けたいもの"];
const questions = ["普段、どこから旅に出ますか？", "誰と旅行することが多いですか？", "旅行では、どちらに近いですか？", "旅行で心惹かれるものを選んでください", "どんな旅に惹かれますか？", "どれくらいの移動なら旅行として楽しめますか？", "旅行で、なるべく避けたいものはありますか？"];
type Draft = Omit<UserProfile, "version" | "updatedAt">;

export function configureTravelProfile(
  document: Document,
  storage: Storage,
  onProfileCompleted: () => void = () => undefined,
): void {
  const dialog = document.querySelector<HTMLDialogElement>("#travel-profile-dialog");
  const toggle = document.querySelector<HTMLButtonElement>("#travel-profile-toggle");
  if (!dialog || !toggle) return;
  let step = -1;
  let complete = false;
  let matchedConcierge: ConciergeProfile | undefined;
  let conciergeMatchState: "searching" | "result" | undefined;
  let draft = createDraft(loadUserProfile(storage));
  const render = () => {
    dialog.innerHTML = conciergeMatchState && matchedConcierge
      ? conciergeMatch(matchedConcierge, conciergeMatchState === "searching")
      : complete ? completion(draft) : step < 0 ? introduction() : onboarding(draft, step);
    bind();
  };
  const update = () => {
    const form = dialog.querySelector<HTMLFormElement>("form");
    if (form) draft = readDraft(draft, new FormData(form), step);
  };
  const bind = () => {
    dialog.querySelector<HTMLButtonElement>("[data-close]")?.addEventListener("click", () => dialog.close());
    dialog.querySelector<HTMLButtonElement>("[data-begin]")?.addEventListener("click", () => { step = 0; render(); });
    dialog.querySelector<HTMLButtonElement>("[data-match-continue]")?.addEventListener("click", () => { conciergeMatchState = undefined; complete = true; render(); });
    dialog.querySelector<HTMLButtonElement>("[data-back]")?.addEventListener("click", () => { update(); step -= 1; render(); });
    dialog.querySelector<HTMLButtonElement>("[data-edit]")?.addEventListener("click", () => { conciergeMatchState = undefined; complete = false; step = 0; render(); });
    dialog.querySelector<HTMLButtonElement>("[data-delete]")?.addEventListener("click", () => { deleteUserProfile(storage); document.dispatchEvent(new Event(travelProfileChangedEvent)); matchedConcierge = undefined; conciergeMatchState = undefined; draft = createDraft(); complete = false; step = -1; render(); });
    dialog.querySelector<HTMLButtonElement>("[data-start]")?.addEventListener("click", () => {
      dialog.close();
      onProfileCompleted();
    });
    dialog.querySelector("[name=companions]")?.addEventListener("change", () => { update(); render(); });
    dialog.querySelector<HTMLFormElement>("form")?.addEventListener("submit", event => {
      event.preventDefault(); update();
      if (step < 6) { step += 1; render(); return; }
      const saved = saveUserProfile(storage, draft);
      document.dispatchEvent(new Event(travelProfileChangedEvent));
      matchedConcierge = selectConciergeForUserProfile(saved);
      conciergeMatchState = "searching";
      render();
      window.setTimeout(() => {
        if (conciergeMatchState === "searching") {
          conciergeMatchState = "result";
          render();
        }
      }, 900);
    });
  };
  toggle.addEventListener("click", () => { matchedConcierge = undefined; conciergeMatchState = undefined; draft = createDraft(loadUserProfile(storage)); complete = true; render(); dialog.showModal(); });
  if (!loadUserProfile(storage)) { render(); dialog.showModal(); }
}

export function profileIntroductionGreeting(date = new Date()): string {
  const hour = date.getHours();
  return hour >= 18 || hour < 5 ? "こんばんは" : "こんにちは";
}

function introduction(): string {
  return '<section class="travel-profile-introduction"><button type="button" class="travel-profile-dismiss" data-close aria-label="閉じる">×</button><span class="travel-complete-icon" aria-hidden="true">✦</span><p class="travel-onboarding-eyebrow">あなたの旅を知る</p><h2>' + profileIntroductionGreeting() + '</h2><p>これからいくつか質問します。あなたに合う旅の楽しみ方を見つけて、コンシェルジュが旅行プランをご案内します。</p><button type="button" class="travel-profile-next" data-begin>はじめる</button><small>入力内容はこの端末にだけ保存されます</small></section>';
}

function conciergeMatch(concierge: ConciergeProfile, searching: boolean): string {
  if (searching) {
    return '<section class="travel-concierge-match travel-concierge-searching"><span class="travel-match-orbit" aria-hidden="true"><i>✦</i></span><p class="travel-onboarding-eyebrow">あなたの旅を知る</p><h2>相性の良さそうなコンシェルジュを探しています</h2><p>旅の好みやペースをもとに、これからの旅を一緒に考える案内役を選んでいます。</p></section>';
  }
  return '<section class="travel-concierge-match"><p class="travel-onboarding-eyebrow">あなたのコンシェルジュ</p><img src="' + esc(concierge.presentation.image) + '" alt="' + esc(concierge.presentation.name) + 'のアバター"><h2>' + esc(concierge.presentation.name) + '</h2><strong>' + esc(concierge.presentation.role) + '</strong><p>「' + esc(conciergeWelcomeMessage(concierge)) + '」</p><button type="button" class="travel-profile-next" data-match-continue>旅のスタイルを見る</button></section>';
}

export function conciergeWelcomeMessage(concierge: ConciergeProfile): string {
  const closing = concierge.conversation.voice.politeness === "casual"
    ? "よろしくね"
    : concierge.conversation.voice.politeness === "formal"
      ? "よろしくお願いいたします"
      : "よろしくお願いします";
  return `${concierge.conversation.greeting} ${concierge.presentation.name}です。${closing}`;
}

function onboarding(draft: Draft, step: number): string {
  return '<form class="travel-onboarding"><header class="travel-onboarding-header"><span class="travel-onboarding-eyebrow">あなたの旅を知る ' + (step + 1) + ' / 7</span><button type="button" class="travel-profile-dismiss" data-close aria-label="閉じる">×</button><h2>' + titles[step] + '</h2><p>' + questions[step] + '</p></header><div class="travel-onboarding-progress"><i style="width:' + ((step + 1) / 7 * 100) + '%"></i></div><section class="travel-onboarding-body">' + stepBody(draft, step) + '</section><footer><button type="button" class="travel-profile-back" data-back ' + (step === 0 ? "hidden" : "") + '>戻る</button><button type="submit" class="travel-profile-next">' + (step === 6 ? "旅のスタイルを見る" : "次へ") + '</button></footer></form>';
}
function stepBody(draft: Draft, step: number): string {
  if (step === 0) return '<div class="travel-profile-stack"><label>駅名またはエリア<input name="home" value="' + esc(draft.home.station ?? draft.home.area ?? "") + '" placeholder="例: 京都駅、京都市" autofocus></label><small>駅名が決まっていなくても大丈夫です</small><fieldset class="travel-profile-choice"><legend>車を使えますか？</legend>' + radio("car", "yes", "使える", draft.home.carAvailable) + radio("car", "no", "使わない", !draft.home.carAvailable) + '</fieldset></div>';
  if (step === 1) return '<div class="travel-profile-chips">' + companionOptions.map(([value, label]) => choice("companions", value, label, draft.companions.usual.includes(value))).join("") + '</div>' + (draft.companions.usual.includes("children") ? '<fieldset class="travel-profile-choice"><legend>お子さんの年齢は？</legend>' + ageGroups.map(([value, label]) => choice("ages", value, label, draft.companions.children.some(child => child.ageGroup === value))).join("") + '</fieldset>' : "");
  if (step === 2) return slider("pace", draft.travelStyle.pace, "ゆっくりしたい", "いろいろ回りたい", "旅行のペース");
  if (step === 3) return '<div class="travel-preference-grid">' + preferenceKeys.map(key => '<label class="travel-preference-card"><input type="checkbox" name="interest" value="' + key + '" ' + (draft.preferences[key] >= .8 ? "checked" : "") + '><span>' + icons[key] + '</span><b>' + travelPreferenceLabels[key] + '</b></label>').join("") + '</div>';
  if (step === 4) return '<div class="travel-profile-stack">' + slider("novelty", draft.travelStyle.novelty, "定番", "穴場", "行き先の好み") + slider("pace", draft.travelStyle.pace, "ゆったり", "盛りだくさん", "過ごし方") + '</div>';
  if (step === 5) return '<div class="travel-profile-chips travel-profile-chips-large">' + travelTimes.map(([value, label]) => radio("travel", String(value), label, draft.transport.maxTypicalTravelMinutes === (value === "any" ? null : value))).join("") + '</div>';
  return '<div class="travel-profile-chips travel-profile-chips-large">' + avoidances.map(value => choice("avoid", value, value, avoided(draft).includes(value))).join("") + '</div>';
}
function completion(draft: Draft): string {
  const profile = { ...draft, version: 2, updatedAt: new Date().toISOString() } as UserProfile;
  return '<section class="travel-profile-complete"><span class="travel-complete-icon">✦</span><p>あなたの旅のスタイル</p><h2>' + esc(travelStyleSummary(profile)) + '</h2><small>この内容は端末に保存しました。プロフィールからいつでも変更できます。</small><footer class="travel-profile-complete-actions"><button type="button" class="travel-profile-next" data-start>旅をはじめる</button><button type="button" class="travel-profile-edit-link" data-edit>プロフィールを編集</button></footer></section>';
}
function choice(name: string, value: string, label: string, checked: boolean): string { return '<label><input type="checkbox" name="' + name + '" value="' + value + '" ' + (checked ? "checked" : "") + '><span>' + label + '</span></label>'; }
function radio(name: string, value: string, label: string, checked: boolean): string { return '<label><input type="radio" name="' + name + '" value="' + value + '" ' + (checked ? "checked" : "") + '><span>' + label + '</span></label>'; }
function slider(name: string, value: number, left: string, right: string, label: string): string { return '<label class="travel-profile-slider"><b>' + label + '</b><span>' + left + '<i>● ● ● ● ●</i>' + right + '</span><input type="range" min="0" max="1" step=".25" name="' + name + '" value="' + value + '"></label>'; }
function createDraft(profile?: UserProfile): Draft {
  if (profile) return { home: profile.home, companions: profile.companions, travelStyle: profile.travelStyle, preferences: profile.preferences, transport: profile.transport };
  return { home: { carAvailable: false }, companions: { usual: [], children: [] }, travelStyle: { pace: .5, novelty: .5, crowdTolerance: .5, walkingTolerance: .5, transferTolerance: .5, earlyMorningTolerance: .5, lateNightTolerance: .5, drivingTolerance: .5, busTolerance: .5 }, preferences: Object.fromEntries(preferenceKeys.map(key => [key, .3])) as Record<TravelPreference, number>, transport: { maxTypicalTravelMinutes: 120 } };
}
function readDraft(draft: Draft, form: FormData, step: number): Draft {
  if (step === 0) { const home = String(form.get("home") ?? "").trim(); return { ...draft, home: { station: isStation(home) ? home : undefined, area: home && !isStation(home) ? home : undefined, carAvailable: form.get("car") === "yes" } }; }
  if (step === 1) { const usual = form.getAll("companions") as TravelCompanion[]; return { ...draft, companions: { usual, children: usual.includes("children") ? form.getAll("ages").map(value => ({ ageGroup: String(value) as ChildAgeGroup })) : [] } }; }
  if (step === 2 || step === 4) return { ...draft, travelStyle: { ...draft.travelStyle, pace: numeric(form.get("pace"), draft.travelStyle.pace), novelty: step === 4 ? numeric(form.get("novelty"), draft.travelStyle.novelty) : draft.travelStyle.novelty } };
  if (step === 3) { const selected = new Set(form.getAll("interest").map(String)); return { ...draft, preferences: Object.fromEntries(preferenceKeys.map(key => [key, selected.has(key) ? .8 : .3])) as Record<TravelPreference, number> }; }
  if (step === 5) return { ...draft, transport: { maxTypicalTravelMinutes: form.get("travel") === "any" ? null : numeric(form.get("travel"), 120) } };
  const selected = new Set(form.getAll("avoid").map(String)); const tolerance = (value: string) => selected.has("特になし") ? 1 : selected.has(value) ? .2 : .7;
  return { ...draft, travelStyle: { ...draft.travelStyle, crowdTolerance: tolerance("混雑"), walkingTolerance: tolerance("長時間歩く"), transferTolerance: tolerance("何度も乗り換える"), earlyMorningTolerance: tolerance("朝早い"), lateNightTolerance: tolerance("夜遅い"), drivingTolerance: tolerance("車の運転"), busTolerance: tolerance("バス移動") } };
}
function avoided(draft: Draft): string[] { const values: Array<[string, number]> = [["混雑", draft.travelStyle.crowdTolerance], ["長時間歩く", draft.travelStyle.walkingTolerance], ["何度も乗り換える", draft.travelStyle.transferTolerance], ["朝早い", draft.travelStyle.earlyMorningTolerance], ["夜遅い", draft.travelStyle.lateNightTolerance], ["車の運転", draft.travelStyle.drivingTolerance], ["バス移動", draft.travelStyle.busTolerance]]; return values.filter(([, value]) => value < .5).map(([value]) => value); }
function isStation(value: string): boolean { return value.endsWith("駅"); }
function numeric(value: FormDataEntryValue | null, fallback: number): number { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function esc(value: string): string { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
