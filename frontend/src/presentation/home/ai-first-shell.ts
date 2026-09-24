import { homeReadModel, tripDisplayLabels, type HomeReadInput } from "../../usecases/trip-plan/home-read-model";
import { travelIcon } from "../shared/travel-icon";
import { travelDecoration } from "./travel-decoration";
import { iconMarkup, pageHeadingMarkup, type ProductIconName } from "../shared/primitives";
import type { Trip } from "@raiquora/trip/trip";
import { itineraryScheduleLabel } from "../../usecases/trip-plan/itinerary-schedule-label";
import { tripPartyView } from "../../usecases/trip-plan/trip-party-presentation";
import type { TripReadiness } from "@raiquora/trip/trip-readiness";
import type { AuthState } from "../../usecases/auth/auth-session";

export type PrimaryView = "explore" | "chat" | "trips" | "my";
export interface AiFirstShellPorts {
  read(): HomeReadInput;
  authState(): AuthState;
  login(): void;
  logout(): void;
  subscribe(listener: () => void): () => void;
  retry(): Promise<void>;
  newConsultation(prompt: string): void;
  openChat(): void;
  openTrip(id: string): void;
  openTravelMode?(id: string): void;
  consultTrip?(id: string): void;
  renameTrip?(id: string, title: string): Promise<void>;
  archiveTrip?(id: string): Promise<void>;
  openMap(): void;
  journeySettings(): { transferPace: string; rankingPreference: string };
  setJourneySettings(settings: { transferPace: string; rankingPreference: string }): void;
  openNotifications(): void;
  canLeave?(): boolean;
  now(): Date;
}

/** Owns navigation only; URL never contains a Trip document, owner or sharing credential. */
export function configureAiFirstShell(document: Document, app: HTMLElement, ports: AiFirstShellPorts) {
  const window = document.defaultView!;
  const root = document.createElement("section"); root.className = "product-shell";
  const navigation: Array<[PrimaryView, string, ProductIconName]> = [["explore", "探す", "explore"], ["chat", "相談", "chat"], ["trips", "旅程", "trips"]];
  const heroImages = [
    ["/media/home-setouchi-v2.webp", "1672", "941", "瀬戸内海の島々と海辺の町"],
    ["/media/home-kinosaki-v2.webp", "1942", "809", "夕暮れの温泉街と柳の水路"],
    ["/media/home-izumo-v2.webp", "1774", "887", "木立に包まれた神社の参道"],
  ] as const;
  const consultationExamples = ["温泉でゆっくりしたい", "歴史ある街を歩きたい", "おいしいものを楽しみたい", "週末の旅を考えたい"];
  const selectedHeroImage = Math.floor(Math.random() * heroImages.length);
  const selectedExample = consultationExamples[Math.floor(Math.random() * consultationExamples.length)]!;
  root.innerHTML = `<header class="product-header"><a href="#explore" class="product-brand" aria-label="Raiquora ホーム"><img src="/brand/raiquora-wordmark.svg" alt="" width="180" height="40"></a><button type="button" class="product-account ds-button" data-account></button></header>
    <nav class="product-nav" aria-label="メインナビゲーション">${navigation.map(([key, label, icon]) => `<a href="#${key}" data-primary="${key}">${iconMarkup(icon)}<span>${label}</span></a>`).join("")}<button type="button" data-map="realtime" data-map-navigation>${iconMarkup("train")}<span>運行</span></button></nav>
    <section class="product-page" data-page="explore" aria-label="探す"><div class="home-hero" data-home-hero role="region" aria-label="旅の相談を始める"><figure class="home-hero-media">${heroImages.map(([src, width, height, alt], index) => `<img data-hero-image src="${src}" width="${width}" height="${height}" alt="${alt}"${index === selectedHeroImage ? ' fetchpriority="high"' : ' loading="lazy" hidden'}>`).join("")}<figcaption>Raiquora original images</figcaption></figure><div class="home-hero-scrim" aria-hidden="true"></div><div class="home-hero-copy">
    <form class="home-prompt ds-composer"><textarea class="ds-control" id="home-prompt" aria-label="どんな旅にしたいですか？" maxlength="400" rows="1" placeholder="例：${selectedExample}"></textarea><button class="ds-button ds-button--primary" type="submit" aria-label="AIに相談する">${iconMarkup("send")}</button></form>
    </div></div>
    <div data-home-live></div></section>
    <section class="product-page" data-page="trips" aria-label="旅程" hidden><div class="trip-list-heading">${pageHeadingMarkup("YOUR TRIPS", "旅程", "次の旅も、考え中の旅も。ここから続きの相談や確認を始められます。")}</div><div data-trip-list></div></section>
    <section class="product-page" data-page="my" aria-label="アカウント" hidden><div class="my-shell">${pageHeadingMarkup("ACCOUNT", "アカウント")}<div class="my-grid"><section class="home-card my-account-card ds-surface"><h2>ログイン</h2><p data-my-account-status></p><button class="ds-button" type="button" data-my-login>ログイン / 新規登録</button><button class="ds-button" type="button" data-my-logout hidden>ログアウト</button></section><section class="home-card account-profile-card ds-surface" data-signed-in-only><div id="travel-profile-page" class="travel-profile-page" aria-label="旅行プロフィール設定"></div></section>
    <section class="home-card" data-signed-in-only><h2>通知</h2><div class="my-actions"><button type="button" data-notifications>通知 <span aria-hidden="true">→</span></button></div></section><section class="home-card account-journey-settings"><h2>経路検索の設定</h2><p>相談で経路を比較するときの既定値です。</p><label>乗換ペース<select data-account-transfer-pace><option value="hurried">急ぐ</option><option value="standard">普通</option><option value="relaxed">ゆっくり</option></select></label><label>経路の優先<select data-account-ranking-preference><option value="balanced">バランス</option><option value="earliest-arrival">早く着く</option><option value="latest-departure">遅く出る</option><option value="fewest-transfers">乗換少なめ</option></select></label></section><section class="home-card account-services"><h2>外部サービス</h2><p>旅の案内に利用する情報提供元です。</p><ul><li>GTFS-JP・公共交通オープンデータ</li><li>気象庁防災情報XML</li><li>ホットペッパーグルメ Webサービス</li><li>Wikipedia / Wikimedia Commons</li></ul></section></div></div></section>`;
  app.prepend(root);
  const header = root.querySelector<HTMLElement>(".product-header")!;
  const explorePage = root.querySelector<HTMLElement>('[data-page="explore"]')!;
  const syncHeader = () => { header.dataset.overlay = String(app.dataset.primaryView === "explore" && explorePage.scrollTop < 24); };
  explorePage.addEventListener("scroll", syncHeader, { passive: true });
  const services = root.querySelector<HTMLUListElement>(".account-services ul")!;
  services.className = "external-service-list";
  services.innerHTML = `<li><strong>Mapbox</strong><span>地図・徒歩と車の移動</span><a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noreferrer">地図の帰属表示</a></li><li><strong>OpenStreetMap contributors</strong><span>地図データ</span><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">著作権とライセンス</a></li><li><strong>Open-Meteo</strong><span>天気予報</span><a href="https://open-meteo.com/" target="_blank" rel="noreferrer">提供元</a></li><li><strong>気象庁</strong><span>警報・防災情報</span><a href="https://xml.kishou.go.jp/" target="_blank" rel="noreferrer">気象庁防災情報XML</a></li><li><strong>ホットペッパーグルメ Webサービス</strong><span>飲食店候補</span><a href="https://webservice.recruit.co.jp/" target="_blank" rel="noreferrer"><img src="https://webservice.recruit.co.jp/banner/hotpepper-s.gif" width="135" height="17" alt="ホットペッパーグルメ Webサービス" /></a></li><li><strong>Wikipedia / Wikimedia Commons</strong><span>観光情報・画像</span><a href="https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use" target="_blank" rel="noreferrer">利用条件</a></li><li><strong>Amazon Bedrock</strong><span>コンシェルジュの言語モデル</span></li>`;
  let current: PrimaryView = "explore", composing = false;
  const scrolls = new Map<string, number>();
  const textarea = root.querySelector<HTMLTextAreaElement>("#home-prompt")!;
  const draftKey = "raiquora:home-prompt-draft";
  const isSignedIn = () => ports.authState().status === "signed-in";
  const requireAuthentication = () => {
    if (isSignedIn()) return true;
    ports.login();
    return false;
  };
  try { textarea.value = window.sessionStorage.getItem(draftKey)?.slice(0, 400) ?? ""; } catch { /* Optional tab-local draft; never a Trip writer. */ }
  const saveDraft = () => { try { if (textarea.value) window.sessionStorage.setItem(draftKey, textarea.value.slice(0, 400)); else window.sessionStorage.removeItem(draftKey); } catch { /* Storage denial must not block conversation. */ } };
  textarea.addEventListener("input", saveDraft);
  textarea.addEventListener("compositionstart", () => { composing = true; });
  textarea.addEventListener("compositionend", () => { composing = false; });
  textarea.addEventListener("keydown", (event) => { if (event.key === "Enter" && (event.isComposing || composing)) event.stopPropagation(); });
  root.querySelector("form")!.addEventListener("submit", (event) => {
    event.preventDefault();
    if (composing || !textarea.value.trim()) return;
    if (!isSignedIn()) { saveDraft(); ports.login(); return; }
    const prompt = textarea.value.trim(); textarea.value = ""; saveDraft(); navigate("chat"); ports.newConsultation(prompt);
  });
  root.querySelector("[data-account]")!.addEventListener("click", () => {
    if (isSignedIn()) navigate("my"); else ports.login();
  });
  root.querySelector("[data-my-login]")!.addEventListener("click", () => { if (ports.authState().status !== "signed-in") ports.login(); });
  root.querySelector("[data-my-logout]")!.addEventListener("click", ports.logout);
  const transferPace = root.querySelector<HTMLSelectElement>("[data-account-transfer-pace]")!, rankingPreference = root.querySelector<HTMLSelectElement>("[data-account-ranking-preference]")!;
  const updateJourneySettings = () => ports.setJourneySettings({ transferPace: transferPace.value, rankingPreference: rankingPreference.value });
  transferPace.addEventListener("change", updateJourneySettings); rankingPreference.addEventListener("change", updateJourneySettings);
  root.querySelector("[data-notifications]")!.addEventListener("click", ports.openNotifications);
  const render = () => {
    let input: HomeReadInput;
    try { input = ports.read(); } catch { input = { state: "unavailable", trips: [], candidates: [] }; }
    const view = homeReadModel(input, ports.now());
    const auth = ports.authState(), account = root.querySelector<HTMLButtonElement>("[data-account]")!;
    account.innerHTML = iconMarkup("account");
    account.setAttribute("aria-label", auth.status === "signed-in" ? "アカウントを開く" : "ログインまたは新規登録");
    account.title = account.getAttribute("aria-label")!;
    const myStatus = root.querySelector<HTMLElement>("[data-my-account-status]")!, myLogin = root.querySelector<HTMLButtonElement>("[data-my-login]")!, myLogout = root.querySelector<HTMLButtonElement>("[data-my-logout]")!;
    myStatus.textContent = auth.status === "signed-in" ? `${auth.displayName} としてログイン中です。` : "旅程やプロフィールを保存するにはログインしてください。";
    myLogin.hidden = auth.status === "signed-in";
    myLogout.hidden = auth.status !== "signed-in";
    const signedIn = auth.status === "signed-in";
    for (const view of ["chat", "trips"]) root.querySelector<HTMLElement>(`[data-primary="${view}"]`)!.hidden = !signedIn;
    for (const section of root.querySelectorAll<HTMLElement>("[data-signed-in-only]")) section.hidden = auth.status !== "signed-in";
    root.querySelector<HTMLElement>("[data-home-live]")!.hidden = !signedIn;
    const journey = ports.journeySettings(); transferPace.value = journey.transferPace; rankingPreference.value = journey.rankingPreference;
    const stateText = view.state === "loading" ? "旅程を読み込んでいます。" : view.state === "unauthenticated" ? "ログインすると、保存した旅程をここで確認できます。相談はこのまま始められます。"
      : view.state === "unavailable" ? "旅程を取得できませんでした。未予約・準備完了とは判断していません。" : "次の旅はまだ決まっていません。相談から始めてみましょう。";
    root.querySelector("[data-home-live]")!.innerHTML = `${view.preview ? '<p class="preview-notice">開発用の確認データです。保存されません。</p>' : ""}
      <section class="home-next"><h2>${view.next ? tripDisplayLabels[view.next.group] : "次の旅"}</h2>${view.next ? card(view.next.trip, undefined, view.readiness, true, view.next.group === "current") : `<div class="home-empty"><p role="status">${stateText}</p>${travelDecoration("canal")}</div>`}
      ${view.state === "unavailable" ? '<button type="button" data-retry>再試行</button>' : ""}
      </section>
      <section><h2>旅の候補</h2>${view.candidates.length ? `<div class="home-candidates">${view.candidates.map((c, index) => `<article class="home-candidate">${travelDecoration(index % 2 ? "retreat" : "canal")}<div class="home-candidate-copy"><h3>${esc(c.title)}</h3><p>移動の対応範囲を確認した候補です。訪れたい場所や過ごし方を、相談しながら考えられます。</p><div class="home-tags"><span>候補</span><span>未採用</span></div><button type="button" data-candidate="${esc(c.id)}">この候補を相談する <span aria-hidden="true">→</span></button></div></article>`).join("")}</div>` : `<div class="home-empty"><p>まだ行き先が決まっていなくても。<br>上の相談例から、気になる旅を探してみましょう。</p>${travelDecoration("retreat")}</div>`}
      <details><summary>対応範囲について</summary><p>収録駅・日付別時刻表と、駅からのアクセスを確認できる範囲をご案内します。未確認の場所も相談できます。</p></details></section>`;
    root.querySelector("[data-trip-list]")!.innerHTML = view.trips.length ? view.trips.map((row) => card(row.trip, tripDisplayLabels[row.group])).join("") : `<p role="status">${stateText}</p>`;
    root.querySelectorAll<HTMLButtonElement>("[data-trip]").forEach((button) => button.addEventListener("click", () => {
      window.history.pushState({ tripId: button.dataset.trip! }, "", "#trip"); apply();
    }));
    root.querySelectorAll<HTMLButtonElement>("[data-trip-chat]").forEach((button) => button.addEventListener("click", () => {
      if (!view.trips.some((row) => row.trip.id === button.dataset.tripChat)) return;
      ports.consultTrip?.(button.dataset.tripChat!); navigate("chat");
    }));
    root.querySelectorAll<HTMLButtonElement>("[data-trip-travel]").forEach((button) => button.addEventListener("click", () => {
      if (!view.trips.some((row) => row.trip.id === button.dataset.tripTravel)) return;
      ports.openTravelMode?.(button.dataset.tripTravel!);
    }));
    root.querySelectorAll<HTMLButtonElement>("[data-trip-rename]").forEach((button) => button.addEventListener("click", () => {
      const current = view.trips.find((row) => row.trip.id === button.dataset.tripRename)?.trip;
      if (!current || !ports.renameTrip) return;
      const title = window.prompt("旅程の名前", current.title)?.trim();
      if (!title || title === current.title) return;
      void ports.renameTrip(current.id, title).then(render, () => { void ports.retry().then(render, render); });
    }));
    root.querySelectorAll<HTMLButtonElement>("[data-trip-archive]").forEach((button) => button.addEventListener("click", () => {
      const current = view.trips.find((row) => row.trip.id === button.dataset.tripArchive)?.trip;
      if (!current || !ports.archiveTrip || !window.confirm(`「${current.title}」をアーカイブしますか？`)) return;
      void ports.archiveTrip(current.id).then(render, () => { void ports.retry().then(render, render); });
    }));
    root.querySelectorAll<HTMLButtonElement>("[data-candidate]").forEach((button) => button.addEventListener("click", () => {
      const candidate = view.candidates.find((value) => value.id === button.dataset.candidate);
      if (!candidate) return;
      navigate("chat"); ports.newConsultation(`「${candidate.title}」の候補について相談したいです。`);
    }));
    if (signedIn && window.location.hash === "#trip" && typeof window.history.state?.tripId === "string") ports.openTrip(window.history.state.tripId);
    root.querySelectorAll("[data-retry]").forEach((button) => button.addEventListener("click", () => { void ports.retry().then(render, render); }));
    if (!signedIn && current !== "explore") { window.history.replaceState(null, "", "#explore"); apply(); }
  };
  const apply = () => {
    let route = window.location.hash.slice(1);
    if (["chat", "trips", "my", "map", "trip"].includes(route) && !isSignedIn()) {
      window.history.replaceState(null, "", "#explore"); route = "explore";
    }
    const previous = root.querySelector<HTMLElement>(`[data-page="${current}"]`); if (previous) scrolls.set(current, previous.scrollTop);
    const isMap = route === "map";
    const isTrip = route === "trip";
    if (["explore", "chat", "trips", "my"].includes(route)) current = route as PrimaryView;
    else if (isTrip) current = "trips";
    else if (!isMap) current = "explore";
    app.dataset.primaryView = isMap ? "map" : isTrip ? "trip" : current;
    for (const page of root.querySelectorAll<HTMLElement>("[data-page]")) page.hidden = isMap || isTrip || page.dataset.page !== current;
    root.querySelectorAll<HTMLElement>("[data-primary]").forEach((a) => { if (!isMap && a.dataset.primary === current) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    const mapNavigation = root.querySelector<HTMLElement>("[data-map-navigation]")!;
    if (isMap) mapNavigation.setAttribute("aria-current", "page"); else mapNavigation.removeAttribute("aria-current");
    if (!isMap && current === "chat") ports.openChat();
    if (isTrip && isSignedIn() && typeof window.history.state?.tripId === "string") ports.openTrip(window.history.state.tripId);
    if (isMap) {
      ports.openMap();
    }
    const page = root.querySelector<HTMLElement>(`[data-page="${current}"]`); if (page) page.scrollTop = scrolls.get(current) ?? 0;
    syncHeader();
  };
  function navigate(view: PrimaryView) {
    if (view !== "explore" && !requireAuthentication()) return;
    if (view !== current && ports.canLeave?.() === false) return;
    if (!document.dispatchEvent(new Event("transitforge:profile-leave", { cancelable: true }))) return;
    window.history.pushState(null, "", `#${view}`); apply();
  }
  root.querySelectorAll<HTMLAnchorElement>("[data-primary], .product-brand").forEach((link) => link.addEventListener("click", (event) => { event.preventDefault(); navigate(link.hash.slice(1) as PrimaryView); }));
  function showMap() {
    if (!requireAuthentication()) return;
    if (ports.canLeave?.() === false) return;
    window.history.pushState({ returnView: current }, "", "#map"); apply();
  }
  root.querySelectorAll<HTMLButtonElement>("[data-map]").forEach((button) => button.addEventListener("click", () => showMap()));
  window.addEventListener("popstate", apply); window.addEventListener("hashchange", apply);
  document.addEventListener("transitforge:travel-profile-changed", render);
  ports.subscribe(render); render(); apply();
  return { navigate, showMap, refresh: render };
}
function esc(value: string): string { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
function card(trip: Trip, group?: string, readiness?: TripReadiness, withPreparation = false, withTravelMode = false): string {
  const dates = [...new Set(trip.items.map((item) => itineraryScheduleLabel(item.schedule)))];
  const party = tripPartyView(trip)?.text;
  const preparation = readiness?.preparation.readState === "available"
    ? `準備リストの残り ${readiness.preparation.categories.reduce((n, c) => n + c.open, 0)}件` : "準備リストは、これから確認";
const booking = readiness?.reservations.readState === "available" ? "予約の記録は旅程で確認できます" : "予約状況はまだ確認できていません";
return `<article class="home-card home-trip-card"><div class="home-trip-copy">${group ? `<small>${esc(group)}</small>` : ""}<h3>${esc(trip.title)}</h3><div class="home-tags">${dates.slice(0, 2).map((date) => `<span>${esc(date)}</span>`).join("")}${party ? `<span>${esc(party)}</span>` : ""}</div><p>${trip.items.length}件の予定から、旅をゆっくり整えましょう。</p><button type="button" data-trip="${esc(trip.id)}">旅程を見る <span aria-hidden="true">→</span></button><button type="button" data-trip-chat="${esc(trip.id)}">AIに相談</button>${withTravelMode ? `<button type="button" data-trip-travel="${esc(trip.id)}">旅行モードを開く</button>` : ""}<span class="home-trip-manage"><button type="button" data-trip-rename="${esc(trip.id)}">名称を編集</button><button type="button" data-trip-archive="${esc(trip.id)}">アーカイブ</button></span></div>${withPreparation ? `<aside class="home-trip-preparation"><div class="home-trip-art" aria-hidden="true">${travelIcon("trip")}</div><h4>出発までに</h4><ul><li>${preparation}</li><li>${booking}</li></ul></aside>` : `<div class="home-trip-art" aria-hidden="true">${travelIcon("trip")}</div>`}</article>`;
}
