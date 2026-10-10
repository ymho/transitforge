import { brandLogoMarkup } from "../shared/brand";
import { configureTripLibrary } from "./trip-library-panel";
import type { TripLibraryClient } from "../../usecases/trip-plan/trip-library-client";
import { homeReadModel, tripDisplayLabels, type HomeReadInput } from "../../usecases/trip-plan/home-read-model";
import { adoptComposer, iconMarkup, pageHeadingMarkup, loadingMarkup, setLoadingStatus, type ProductIconName } from "../shared/primitives";
import type { Trip } from "@raiquora/trip/trip";
import { tripCoverImage } from "../shared/trip-cover";
import { tripDateLabel } from "../../usecases/trip-plan/trip-header-presentation";
import { partyMarkup } from "../trip-plan/trip-party-control";
import type { AuthState } from "../../usecases/auth/auth-session";

export type PrimaryView = "chat" | "trips" | "my";
export interface AiFirstShellPorts {
  library?: TripLibraryClient;
  librarySession?(): number;
  read(): HomeReadInput;
  authState(): AuthState;
  login(): void;
  logout(): void;
  subscribe(listener: () => void): () => void;
  retry(): Promise<void>;
  newConsultation(prompt: string): Promise<void | { tripId: string }>;
  resetConsultation(): void;
  cancelNavigation?(): void;
  openChat(): void;
  openTrip(id: string): Promise<void> | void;
  openTravelMode?(id: string): void;
  consultTrip?(id: string): Promise<void> | void;
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
  const navigation: Array<[PrimaryView, string, ProductIconName]> = [["chat", "相談", "chat"], ["trips", "旅程", "trips"]];
  const heroImages = [
    ["/media/home-setouchi-v2.webp", "1672", "941", "瀬戸内海の島々と海辺の町"],
    ["/media/home-kinosaki-v2.webp", "1942", "809", "夕暮れの温泉街と柳の水路"],
    ["/media/home-izumo-v2.webp", "1774", "887", "木立に包まれた神社の参道"],
  ] as const;
  const consultationExamples = ["週末にしたいことは？", "来週、出雲大社にいきたい", "リラックスできる旅を提案して"];
  const selectedHeroImage = Math.floor(Math.random() * heroImages.length);
  const selectedExample = consultationExamples[0]!;
  root.innerHTML = `<nav class="product-nav" aria-label="メインナビゲーション"><div class="product-brand">${brandLogoMarkup()}</div>${navigation.map(([key, label, icon]) => `<a href="#${key}" data-primary="${key}">${iconMarkup(icon)}<span>${label}</span></a>`).join("")}<button type="button" data-map="realtime" data-map-navigation>${iconMarkup("train")}<span>運行</span></button><button type="button" data-account>${iconMarkup("account")}<span>設定</span></button></nav>
    <section class="product-page" data-page="chat" aria-label="相談"><div class="home-hero" data-home-hero role="region" aria-label="旅の相談を始める"><figure class="home-hero-media">${heroImages.map(([src, width, height, alt], index) => `<img data-hero-image src="${src}" width="${width}" height="${height}" alt="${alt}"${index === selectedHeroImage ? ' fetchpriority="high"' : ' loading="lazy" hidden'}>`).join("")}<figcaption>KAIHO original images</figcaption></figure><div class="home-hero-scrim" aria-hidden="true"></div><div class="home-hero-copy">
    <div class="home-brand">${brandLogoMarkup()}</div><form class="home-prompt"><textarea id="home-prompt" aria-label="どんな旅にしたいですか？" maxlength="400" rows="1" placeholder="${selectedExample}"></textarea><button type="submit" aria-label="AIに相談する">${iconMarkup("send")}</button></form>
    <section class="home-brand-story" aria-label="KAIHOについて"><h1>あなただけの旅を、一緒に形にします。</h1><p>その昔、旅に役立つ情報をまとめ、懐に収めて持ち歩ける案内書や地図が「懐宝」と名付けられました。</p><p>旅に必要なものを、いつでも手元に。その思いを受け継ぎ、KAIHOは新しい旅のパートナーとして生まれました。</p><p>AIとともに、行きたい場所や体験したいことを一つの旅へ。旅先の発見から、移動や旅程づくりまで、あなたの旅づくりをサポートします。</p></section><p class="consultation-entry-error" data-consultation-error role="status" hidden></p></div></div><section class="home-official-guides" data-home-official-guides aria-labelledby="home-official-heading"><h2 id="home-official-heading">公式しおり</h2><div data-official-own hidden></div></section><div class="consultation-entry-progress" data-consultation-progress hidden><p role="status" data-consultation-status></p><button type="button" data-consultation-retry hidden>再試行</button></div></section>
    <section class="trip-route-progress" data-trip-route-progress role="status" hidden></section>
    <section class="product-page" data-page="trips" aria-label="旅程" hidden><div class="trip-list-heading">${pageHeadingMarkup("", "旅のしおり")}</div><div data-trip-list></div></section>
    <section class="product-page" data-page="my" aria-label="設定" hidden><div class="my-shell">${pageHeadingMarkup("", "設定")}<div class="my-grid"><section class="home-card my-account-card ds-surface"><h2>ログイン</h2><p data-my-account-status></p><button class="ds-button" type="button" data-my-login>ログイン</button><button class="ds-button" type="button" data-my-logout hidden>ログアウト</button></section><section class="home-card account-profile-card ds-surface" data-signed-in-only><div id="travel-profile-page" class="travel-profile-page" aria-label="いつもの好み設定"></div></section>
    <section class="home-card" data-signed-in-only><h2>通知</h2><div class="my-actions"><button type="button" data-notifications>通知 <span aria-hidden="true">→</span></button></div></section><section class="home-card account-journey-settings"><h2>経路検索の設定</h2><p>相談で経路を比較するときの既定値です。</p><label>乗換ペース<select data-account-transfer-pace><option value="hurried">急ぐ</option><option value="standard">普通</option><option value="relaxed">ゆっくり</option></select></label><label>経路の優先<select data-account-ranking-preference><option value="balanced">バランス</option><option value="earliest-arrival">早く着く</option><option value="latest-departure">遅く出る</option><option value="fewest-transfers">乗換少なめ</option></select></label></section><section class="home-card account-services"><h2>外部サービス</h2><p>旅の案内に利用する情報提供元です。</p><ul><li>GTFS-JP・公共交通オープンデータ</li><li>気象庁防災情報XML</li><li>ホットペッパーグルメ Webサービス</li><li>Wikipedia / Wikimedia Commons</li></ul></section></div></div></section>`;
  app.prepend(root);
  const dismissTripMenus = (event: Event) => {
    const target = event.target;
    if (!(target instanceof window.Node)) return;
    for (const menu of app.querySelectorAll<HTMLDetailsElement>(".home-trip-manage[open], .trip-header-management[open]")) {
      if (!menu.contains(target)) menu.open = false;
    }
  };
  document.addEventListener("click", dismissTripMenus, true);

  const services = root.querySelector<HTMLUListElement>(".account-services ul")!;
  services.className = "external-service-list";
  services.innerHTML = `<li><strong>Mapbox</strong><span>地図・徒歩と車の移動</span><a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noreferrer">地図の帰属表示</a></li><li><strong>OpenStreetMap contributors</strong><span>地図データ</span><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">著作権とライセンス</a></li><li><strong>Open-Meteo</strong><span>天気予報</span><a href="https://open-meteo.com/" target="_blank" rel="noreferrer">提供元</a></li><li><strong>気象庁</strong><span>警報・防災情報</span><a href="https://xml.kishou.go.jp/" target="_blank" rel="noreferrer">気象庁防災情報XML</a></li><li><strong>ホットペッパーグルメ Webサービス</strong><span>飲食店候補</span><a href="https://webservice.recruit.co.jp/" target="_blank" rel="noreferrer"><img src="https://webservice.recruit.co.jp/banner/hotpepper-s.gif" width="135" height="17" alt="ホットペッパーグルメ Webサービス" /></a></li><li><strong>Wikipedia / Wikimedia Commons</strong><span>観光情報・画像</span><a href="https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use" target="_blank" rel="noreferrer">利用条件</a></li><li><strong>Amazon Bedrock</strong><span>コンシェルジュの言語モデル</span></li>`;
  const settings = root.querySelector<HTMLElement>(".my-grid")!;
  const settingsSections: Array<[string, string, ProductIconName]> = [[".account-profile-card", "いつもの好み", "account"], [".account-journey-settings", "経路検索", "train"], ["[data-notifications]", "通知", "notifications"], [".my-account-card", "アカウント", "account"], [".account-services", "このサービスについて", "info"]];
  for (const [selector, label, icon] of settingsSections) {
    const found = settings.querySelector<HTMLElement>(selector)!;
    const section = selector === "[data-notifications]" ? found.closest<HTMLElement>("section")! : found;
    const wrapper = document.createElement("details"); wrapper.className = "settings-section";
    if (section.hasAttribute("data-signed-in-only")) { wrapper.setAttribute("data-signed-in-only", ""); section.removeAttribute("data-signed-in-only"); }
    const summary = document.createElement("summary"); summary.innerHTML = `${iconMarkup(icon)}<span>${label}</span>`;
    wrapper.append(summary, section); settings.append(wrapper);
  }
  let libraryUi: ReturnType<typeof configureTripLibrary> | undefined;
  let officialUi: ReturnType<typeof configureTripLibrary> | undefined;
  let current: PrimaryView = "chat", composing = false;
  let consultationMode: "landing" | "starting" | "conversation" | "unavailable" = "landing";
  let entryGeneration = 0, appliedRoute = "";
  let tripEntry: "loading" | "loaded" | "unavailable" = "loaded";
  let pendingTripId: string | undefined;
  const scrolls = new Map<string, number>();
  const textarea = root.querySelector<HTMLTextAreaElement>("#home-prompt")!;
  let exampleIndex = 0;
  const exampleTimer = window.setInterval(() => {
    if (textarea.value || document.activeElement === textarea || document.hidden || root.querySelector<HTMLElement>("[data-home-hero]")!.hidden) return;
    exampleIndex = (exampleIndex + 1) % consultationExamples.length;
    textarea.placeholder = consultationExamples[exampleIndex]!;
  }, 4000);
  const homeForm = root.querySelector<HTMLFormElement>(".home-prompt")!;
  const homeSubmit = homeForm.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  adoptComposer(homeForm, textarea, homeSubmit);
  const draftKey = "raiquora:home-prompt-draft";
  const pendingKey = "raiquora:home-prompt-submit";
  let pendingPrompt: string | undefined;
  try { pendingPrompt = window.sessionStorage.getItem(pendingKey) ?? undefined; } catch { /* Optional redirect recovery. */ }
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
  homeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (composing || consultationMode === "starting" || !textarea.value.trim()) return;
    if (!isSignedIn()) {
      saveDraft(); pendingPrompt = textarea.value.trim();
      try { window.sessionStorage.setItem(pendingKey, pendingPrompt); } catch { /* Same-document authentication can still resume. */ }
      ports.login(); return;
    }
    if (!canNavigate()) return;
    pendingPrompt = undefined;
    try { window.sessionStorage.removeItem(pendingKey); } catch { /* Do not block sending. */ }
    const prompt = textarea.value.trim(), generation = ++entryGeneration;
    entryError.textContent = "";
    consultationMode = "starting";
    entryStatus.textContent = "相談を始めています。";
    replaceRoute("chat", { consultation: "active" });
    try {
      const started = await ports.newConsultation(prompt);
      if (generation !== entryGeneration || !root.isConnected || !isSignedIn()) return;
      textarea.value = ""; saveDraft();
      consultationMode = "conversation";
      if (started?.tripId) showConversation(started.tripId); else paintRoute();
      ports.openChat();
    } catch {
      if (generation !== entryGeneration || !root.isConnected) return;
      consultationMode = "landing";
      entryError.textContent = "相談を開始できませんでした。入力は残しています。もう一度送信してください。";
      replaceRoute("chat", { consultation: "new" });
    }
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
    if (!root.isConnected) return;
    libraryUi?.refresh(); officialUi?.refresh();
    let input: HomeReadInput;
    try { input = ports.read(); } catch { input = { state: "unavailable", trips: [] }; }
    const view = homeReadModel(input, ports.now());
    const auth = ports.authState(), account = root.querySelector<HTMLButtonElement>("[data-account]")!;
    account.innerHTML = `${iconMarkup("account")}<span>設定</span>`;
    account.setAttribute("aria-label", auth.status === "signed-in" ? "設定を開く" : "ログイン");
    account.title = account.getAttribute("aria-label")!;
    const myStatus = root.querySelector<HTMLElement>("[data-my-account-status]")!, myLogin = root.querySelector<HTMLButtonElement>("[data-my-login]")!, myLogout = root.querySelector<HTMLButtonElement>("[data-my-logout]")!;
    myStatus.textContent = auth.status === "signed-in" ? `${auth.displayName} としてログイン中です。` : "旅程やプロフィールを保存するにはログインしてください。";
    myLogin.hidden = auth.status === "signed-in";
    myLogout.hidden = auth.status !== "signed-in";
    const signedIn = auth.status === "signed-in";
    for (const view of ["trips"]) root.querySelector<HTMLElement>(`[data-primary="${view}"]`)!.hidden = !signedIn;
    for (const section of root.querySelectorAll<HTMLElement>("[data-signed-in-only]")) section.hidden = auth.status !== "signed-in";
    const journey = ports.journeySettings(); transferPace.value = journey.transferPace; rankingPreference.value = journey.rankingPreference;
    const stateText = view.state === "loading" ? "旅程を読み込んでいます。" : view.state === "unauthenticated" ? "ログインすると、保存した旅程をここで確認できます。相談はこのまま始められます。"
      : view.state === "unavailable" ? "旅程を取得できませんでした。未予約・準備完了とは判断していません。" : "次の旅はまだ決まっていません。相談から始めてみましょう。";
    root.querySelector("[data-trip-list]")!.innerHTML = view.trips.length ? view.trips.map((row) => card(row.trip, tripDisplayLabels[row.group], row.group === "current")).join("") : `<p role="status" aria-busy="${view.state === "loading"}">${view.state === "loading" ? loadingMarkup(stateText) : stateText}</p>`;
    root.querySelectorAll<HTMLButtonElement>("[data-trip]").forEach((button) => button.addEventListener("click", () => {
      if (!canNavigate()) return;
      window.history.pushState({ tripId: button.dataset.trip! }, "", "#trip"); apply();
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
      if (!current || !ports.archiveTrip || !window.confirm(`「${current.title}」を削除しますか？\n画面から元に戻すことはできません。宿泊や列車の予約は取り消されません。`)) return;
      void ports.archiveTrip(current.id).then(render, () => { void ports.retry().then(render, render); });
    }));
    if (!signedIn && (window.location.hash !== "#chat" || consultationMode !== "landing")) {
      window.history.replaceState({ consultation: "new" }, "", "#chat"); apply(true);
    }
  };
  const hero = root.querySelector<HTMLElement>("[data-home-hero]")!;
  const entryError = root.querySelector<HTMLElement>("[data-consultation-error]")!;
  const progress = root.querySelector<HTMLElement>("[data-consultation-progress]")!;
  const entryStatus = root.querySelector<HTMLElement>("[data-consultation-status]")!;
  const entryRetry = root.querySelector<HTMLButtonElement>("[data-consultation-retry]")!;
  const routeKey = () => JSON.stringify([window.location.hash, window.history.state]);
  function canNavigate() {
    return ports.canLeave?.() !== false && document.dispatchEvent(new Event("transitforge:profile-leave", { cancelable: true }));
  }
  function paintRoute() {
    if (!root.isConnected) return;
    const route = window.location.hash.slice(1), isMap = route === "map", isTrip = route === "trip";
    if (route === "trips" || isTrip) current = "trips";
    else if (route === "my") current = "my";
    else if (!isMap) current = "chat";
    app.dataset.primaryView = isMap ? "map" : isTrip ? tripEntry === "loaded" ? "trip" : "trip-loading" : current;
    const tripProgress = root.querySelector<HTMLElement>("[data-trip-route-progress]")!;
    tripProgress.hidden = !isTrip || tripEntry === "loaded";
    setLoadingStatus(tripProgress, tripEntry === "loading" ? "旅程を読み込んでいます。" : "旅程を読み込めませんでした。旅程一覧から再試行してください。", tripEntry === "loading");
    setLoadingStatus(entryStatus, entryStatus.textContent ?? "", consultationMode === "starting");
    app.dataset.consultationMode = consultationMode;
    hero.hidden = consultationMode !== "landing";
    root.querySelector<HTMLElement>("[data-home-official-guides]")!.hidden = consultationMode !== "landing";
    progress.hidden = consultationMode === "landing" || consultationMode === "conversation";
    entryError.hidden = !entryError.textContent;
    entryRetry.hidden = consultationMode !== "unavailable";
    textarea.disabled = homeSubmit.disabled = consultationMode === "starting";
    for (const page of root.querySelectorAll<HTMLElement>("[data-page]")) {
      page.hidden = isMap || isTrip || page.dataset.page !== current || (current === "chat" && consultationMode === "conversation");
    }
    root.querySelectorAll<HTMLElement>("[data-primary]").forEach((a) => {
      if (!isMap && a.dataset.primary === current) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    for (const [selector, selected] of [["[data-map-navigation]", isMap], ["[data-account]", !isMap && current === "my"]] as const) {
      const button = root.querySelector<HTMLElement>(selector)!;
      if (selected) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
    }
  }
  function replaceRoute(route: "chat" | "trip", state: Record<string, unknown>) {
    window.history.replaceState(state, "", `#${route}`); appliedRoute = routeKey(); paintRoute();
  }
  // Feature-driven view changes never invoke a fresh conversation or re-open a Trip.
  function showConversation(tripId?: string) {
    consultationMode = "conversation";
    const state = tripId ? { consultation: "trip", tripId } : { consultation: "active" };
    if (window.location.hash !== "#chat") window.history.pushState(state, "", "#chat");
    else window.history.replaceState(state, "", "#chat");
    appliedRoute = routeKey(); paintRoute();
  }
  function showTrip(tripId: string) {
    if (pendingTripId && pendingTripId !== tripId) return;
    if (!pendingTripId) tripEntry = "loaded";
    if (window.location.hash !== "#trip") window.history.pushState({ tripId }, "", "#trip");
    else window.history.replaceState({ tripId }, "", "#trip");
    appliedRoute = routeKey(); paintRoute();
  }
  let tripNavigationResult: Promise<void> = Promise.resolve();
  function apply(force = false) {
    if (!root.isConnected || !force && appliedRoute === routeKey()) return;
    let route = window.location.hash.slice(1);
    if (!["chat", "trips", "my", "map", "trip"].includes(route) || !isSignedIn() && route !== "chat") {
      window.history.replaceState({ consultation: "new" }, "", "#chat"); route = "chat";
    }
    const previous = root.querySelector<HTMLElement>(`[data-page="${current}"]`);
    if (previous) scrolls.set(current, previous.scrollTop);
    appliedRoute = routeKey();
    const generation = ++entryGeneration;
    pendingTripId = route === "trip" ? window.history.state?.tripId : undefined;
    ports.cancelNavigation?.();
    if (route === "chat") {
      const tripId = window.history.state?.consultation === "trip" ? window.history.state?.tripId : undefined;
      if (isSignedIn() && typeof tripId === "string" && ports.consultTrip) {
        consultationMode = "starting"; entryStatus.textContent = "この旅の相談を読み込んでいます。"; paintRoute();
        void Promise.resolve().then(() => {
          if (generation !== entryGeneration || !root.isConnected || !isSignedIn()) return;
          return ports.consultTrip!(tripId);
        }).then(() => {
          if (generation !== entryGeneration || !root.isConnected || !isSignedIn()) return;
          consultationMode = "conversation"; paintRoute(); ports.openChat();
        }, () => {
          if (generation !== entryGeneration || !root.isConnected) return;
          consultationMode = "unavailable"; entryStatus.textContent = "この旅の相談を読み込めませんでした。再試行してください。"; paintRoute();
        });
      } else {
        // The top-level consultation entry never resumes a previous standalone chat.
        ports.resetConsultation(); consultationMode = "landing"; entryError.textContent = "";
        window.history.replaceState({ consultation: "new" }, "", "#chat"); appliedRoute = routeKey(); paintRoute();
      }
    } else {
      if (route === "trip") tripEntry = "loading";
      paintRoute();
      if (route === "trips") void ports.retry();
      if (route === "trip" && typeof window.history.state?.tripId === "string") {
        const tripId = window.history.state.tripId;
        tripNavigationResult = (async () => {
          if (generation === entryGeneration && isSignedIn()) await ports.openTrip(tripId);
        })();
        void tripNavigationResult.then(() => {
          if (generation !== entryGeneration || !root.isConnected) return;
          pendingTripId = undefined; tripEntry = "loaded"; paintRoute();
        }, () => {
          if (generation !== entryGeneration || !root.isConnected) return;
          pendingTripId = undefined; tripEntry = "unavailable"; paintRoute();
        });
      } else if (route === "trip") { tripEntry = "unavailable"; paintRoute(); }
      if (route === "map") ports.openMap();
    }
    const page = root.querySelector<HTMLElement>(`[data-page="${current}"]`);
    if (page) page.scrollTop = scrolls.get(current) ?? 0;
  }
  function navigate(view: PrimaryView) {
    if (view !== "chat" && !requireAuthentication() || !canNavigate()) return;
    window.history.pushState(view === "chat" ? { consultation: "new", entryId: window.crypto.randomUUID() } : null, "", `#${view}`);
    apply();
  }
  root.querySelectorAll<HTMLAnchorElement>("[data-primary]").forEach((link) => link.addEventListener("click", (event) => {
    event.preventDefault(); navigate(link.hash.slice(1) as PrimaryView);
  }));
  function showMap() {
    if (!requireAuthentication() || !canNavigate()) return;
    window.history.pushState({ returnView: current }, "", "#map"); apply();
  }
  entryRetry.addEventListener("click", () => apply(true));
  root.querySelectorAll<HTMLButtonElement>("[data-map]").forEach((button) => button.addEventListener("click", showMap));
  const historyChanged = () => apply();
  window.addEventListener("popstate", historyChanged); window.addEventListener("hashchange", historyChanged);
  document.addEventListener("transitforge:travel-profile-changed", render);
  const resumePending = () => {
    if (!isSignedIn() || !pendingPrompt || !root.isConnected) return;
    const prompt = pendingPrompt;
    pendingPrompt = undefined;
    try { window.sessionStorage.removeItem(pendingKey); } catch { /* In-memory consumption prevents duplicate notifications. */ }
    if (textarea.value.trim() !== prompt) return;
    homeForm.requestSubmit();
  };
  if (ports.library) libraryUi = configureTripLibrary(root.querySelector<HTMLElement>('[data-page="trips"]')!, root.querySelector<HTMLElement>("[data-trip-list]")!, ports.library, {
    openTrip: async id => { window.history.pushState({ tripId: id }, "", "#trip"); apply(); await tripNavigationResult; },
    authenticated: isSignedIn, session: () => ports.librarySession?.() ?? 0,
  });
  if (ports.library) officialUi = configureTripLibrary(root.querySelector<HTMLElement>("[data-home-official-guides]")!, root.querySelector<HTMLElement>("[data-official-own]")!, ports.library, {
    officialOnly: true, login: ports.login,
    openTrip: async id => { window.history.pushState({ tripId: id }, "", "#trip"); apply(); await tripNavigationResult; },
    authenticated: isSignedIn, session: () => ports.librarySession?.() ?? 0,
  });
  const unsubscribe = ports.subscribe(() => { render(); resumePending(); }); render(); apply(); resumePending();
  return { navigate, showMap, showConversation, showTrip, refresh: render, dispose() {
    ++entryGeneration; window.clearInterval(exampleTimer); unsubscribe(); libraryUi?.dispose(); officialUi?.dispose();
    document.removeEventListener("click", dismissTripMenus, true);
    window.removeEventListener("popstate", historyChanged); window.removeEventListener("hashchange", historyChanged);
    document.removeEventListener("transitforge:travel-profile-changed", render); root.remove();
  } };

}
function esc(value: string): string { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
function card(trip: Trip, group?: string, withTravelMode = false): string {
  return `<article class="home-card home-trip-card"><button class="trip-list-choice" type="button" data-trip="${esc(trip.id)}"><span class="trip-list-cover" aria-hidden="true"><img src="${tripCoverImage(trip.id)}" alt="" loading="lazy"><small>旅のイメージ</small></span><span class="trip-list-copy"><strong>${esc(trip.title)}</strong><small>${esc(tripDateLabel(trip))}</small><span class="trip-party-pair">${partyMarkup(trip)}</span>${group ? `<small>${esc(group)}</small>` : ""}</span><span class="trip-list-open" aria-hidden="true">しおりを開く →</span></button><details class="home-trip-manage"><summary aria-label="旅程の操作">⋯</summary><button type="button" data-trip-rename="${esc(trip.id)}">名称を編集</button><button type="button" data-trip-archive="${esc(trip.id)}">削除</button>${withTravelMode ? `<button type="button" data-trip-travel="${esc(trip.id)}">旅行モードを開く</button>` : ""}</details></article>`;
}
