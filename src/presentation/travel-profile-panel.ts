import { deleteUserProfile, loadUserProfile, saveUserProfile, type TravelCompanion, type TravelPace, type UserProfile } from "../domain/travel-profile";

const options = ["海", "山", "自然", "温泉", "食", "鉄道", "街歩き"];
const avoidances = ["混雑", "早朝", "長時間歩行", "乗換が多い"];
const companions: Array<[TravelCompanion, string]> = [["solo", "一人"], ["partner", "パートナー"], ["family", "家族"], ["children", "子ども"], ["friends", "友人"]];

export function configureTravelProfile(document: Document): void {
  const dialog = document.querySelector<HTMLDialogElement>("#travel-profile-dialog");
  const toggle = document.querySelector<HTMLButtonElement>("#travel-profile-toggle");
  if (!dialog || !toggle) return;
  const render = (profile = loadUserProfile(window.localStorage), editing = false) => {
    dialog.innerHTML = profile && !editing ? viewMarkup(profile) : formMarkup(profile);
    const form = dialog.querySelector<HTMLFormElement>("form");
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = new FormData(form);
      saveUserProfile(window.localStorage, {
        homeStation: String(value.get("homeStation") ?? "").trim(),
        companions: values(value, "companions") as TravelCompanion[], childAgeBands: split(value.get("childAgeBands")), interests: values(value, "interests"),
        pace: String(value.get("pace")) as TravelPace, maximumTravelMinutes: Number(value.get("maximumTravelMinutes")), avoidances: values(value, "avoidances"), carAvailable: value.get("carAvailable") === "yes",
      });
      dialog.close();
    });
    dialog.querySelector<HTMLButtonElement>("[data-profile-edit]")?.addEventListener("click", () => render(profile, true));
    dialog.querySelector<HTMLButtonElement>("[data-profile-delete]")?.addEventListener("click", () => { deleteUserProfile(window.localStorage); render(); });
    dialog.querySelector<HTMLButtonElement>("[data-profile-close]")?.addEventListener("click", () => dialog.close());
  };
  toggle.addEventListener("click", () => { render(); dialog.showModal(); });
  render();
  if (!loadUserProfile(window.localStorage)) dialog.showModal();
}

function formMarkup(profile?: UserProfile): string {
  const checked = (items: string[], value: string) => items.includes(value) ? "checked" : "";
  return `<form method="dialog" class="travel-profile-form"><header><p>旅行プロフィール</p><small>普段の好みを保存します。今回の希望はコンシェルジュへその都度伝えられます。</small></header><label>普段の出発地<input name="homeStation" required value="${escapeHtml(profile?.homeStation ?? "")}" placeholder="例: 京都" /></label><fieldset><legend>よく旅行する同行者</legend>${companions.map(([value, label]) => `<label><input type="checkbox" name="companions" value="${value}" ${checked(profile?.companions ?? [], value)} />${label}</label>`).join("")}</fieldset><label>子どもの年齢帯<input name="childAgeBands" value="${escapeHtml(profile?.childAgeBands.join("、") ?? "")}" placeholder="例: 未就学児、小学生" /></label>${checks("好きなもの", "interests", options, profile?.interests ?? [])}<label>旅行のペース<select name="pace"><option value="relaxed" ${profile?.pace === "relaxed" ? "selected" : ""}>ゆっくり</option><option value="balanced" ${!profile || profile.pace === "balanced" ? "selected" : ""}>バランス</option><option value="active" ${profile?.pace === "active" ? "selected" : ""}>たくさん回りたい</option></select></label><label>許容できる移動時間<select name="maximumTravelMinutes">${[120,180,240,360,480].map(value => `<option value="${value}" ${profile?.maximumTravelMinutes === value || (!profile && value === 180) ? "selected" : ""}>${value / 60}時間まで</option>`).join("")}</select></label>${checks("避けたいもの", "avoidances", avoidances, profile?.avoidances ?? [])}<fieldset><legend>車を利用できるか</legend><label><input type="radio" name="carAvailable" value="yes" ${profile?.carAvailable ? "checked" : ""} />利用できる</label><label><input type="radio" name="carAvailable" value="no" ${!profile || !profile.carAvailable ? "checked" : ""} />利用しない</label></fieldset><footer><button type="button" data-profile-close>あとで設定</button><button type="submit">保存</button></footer></form>`;
}

function viewMarkup(profile: UserProfile): string {
  return `<section class="travel-profile-view"><header><p>旅行プロフィール</p><small>普段の好み</small></header><dl><dt>出発地</dt><dd>${escapeHtml(profile.homeStation)}</dd><dt>同行者</dt><dd>${escapeHtml(profile.companions.join("・") || "未設定")}</dd><dt>好きなもの</dt><dd>${escapeHtml(profile.interests.join("・") || "未設定")}</dd><dt>ペース</dt><dd>${paceLabel(profile.pace)}</dd><dt>移動時間</dt><dd>${profile.maximumTravelMinutes / 60}時間まで</dd></dl><footer><button type="button" data-profile-delete>削除</button><button type="button" data-profile-edit>編集</button><button type="button" data-profile-close>閉じる</button></footer></section>`;
}
function checks(title: string, name: string, list: string[], selected: string[]): string { return `<fieldset><legend>${title}</legend>${list.map(value => `<label><input type="checkbox" name="${name}" value="${value}" ${selected.includes(value) ? "checked" : ""} />${value}</label>`).join("")}</fieldset>`; }
function values(value: FormData, name: string): string[] { return value.getAll(name).filter((item): item is string => typeof item === "string"); }
function split(value: FormDataEntryValue | null): string[] { return typeof value === "string" ? value.split(/[、,]/).map(item => item.trim()).filter(Boolean) : []; }
function paceLabel(value: TravelPace): string { return { relaxed: "ゆっくり", balanced: "バランス", active: "たくさん回りたい" }[value]; }
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character] ?? character); }
