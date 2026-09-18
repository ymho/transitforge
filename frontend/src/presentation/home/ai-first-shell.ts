import { homeReadModel, tripDisplayLabels, type HomeReadInput } from "../../usecases/trip-plan/home-read-model";
import type { UserProfile } from "@raiquora/trip/travel-profile";
import { travelStyleSummary } from "@raiquora/trip/travel-profile";

export type PrimaryView = "explore" | "chat" | "trips" | "my";
export interface AiFirstShellPorts {
  read(): HomeReadInput;
  profile(): UserProfile | undefined;
  subscribe(listener: () => void): () => void;
  retry(): Promise<void>;
  newConsultation(prompt: string): void;
  openChat(): void;
  openTrip(id: string): void;
  openProfile(): void;
  openMap(mode: "realtime" | "simulation"): void;
  openHistory(): void;
  openSettings(): void;
  openNotifications(): void;
  now(): Date;
}

/** Owns navigation only; URL never contains a Trip document, owner or sharing credential. */
export function configureAiFirstShell(document: Document, app: HTMLElement, ports: AiFirstShellPorts) {
  const window = document.defaultView!;
  const root = document.createElement("section"); root.className = "product-shell";
  root.innerHTML = `<header class="product-header"><a href="#explore" class="product-brand">Raiquora</a><span>旅を、ここから。</span></header>
    <nav class="product-nav" aria-label="メインナビゲーション">${Object.entries({ explore: "探す", chat: "相談", trips: "旅程", my: "マイ" }).map(([key, label]) => `<a href="#${key}" data-primary="${key}">${label}</a>`).join("")}</nav>
    <section class="product-page" data-page="explore" aria-label="探す"><div class="home-hero"><p>気持ちから、旅を見つける</p><h1>次の休み、<br>どんな旅にしよう。</h1>
    <p>行き先が決まっていなくても大丈夫。したいことから、一緒に考えましょう。</p>
    <form class="home-prompt"><label for="home-prompt">どんな旅にしたいですか？</label><textarea id="home-prompt" maxlength="400" rows="2" placeholder="静かな場所で、のんびりしたい"></textarea><button type="submit">AIに相談する <span aria-hidden="true">→</span></button></form>
    <div class="home-examples" aria-label="相談の入力例">${["のんびりできる旅を考えたい", "歴史ある街を歩きたい", "おいしいものを楽しみたい"].map((text) => `<button type="button" data-example="${text}">${text}</button>`).join("")}</div><small>相談例です。調査済みのおすすめではありません。</small></div>
    <div data-home-live></div><section class="home-secondary"><h2>移動も、旅の楽しみに</h2><p>列車や運行状況は地図で確認できます。</p><button type="button" data-map="realtime">リアルタイム運行状況</button><button type="button" data-map="simulation">日時指定シミュレーター</button></section></section>
    <section class="product-page" data-page="trips" aria-label="旅程" hidden><h1>旅程</h1><p>読み込んだ旅程を表示します。公開の保存・複数旅程一覧はまだ有効ではありません。</p><div data-trip-list></div></section>
    <section class="product-page" data-page="my" aria-label="マイ" hidden><h1>マイ</h1><section class="home-card"><h2>旅行プロフィール</h2><p data-profile-summary></p><button type="button" data-profile>旅行プロフィールを編集</button><p>この端末に保存されます。登録しなくても相談できます。</p></section>
    <section class="home-secondary"><h2>メニュー</h2><button type="button" data-history>会話履歴</button><button type="button" data-settings>設定・経路の好み</button><button type="button" data-notifications>通知</button><button type="button" data-map="realtime">列車の地図</button><p>ゲスト利用中です。ログイン・クラウド保存はまだ利用できません。</p></section></section>
    <button type="button" class="product-map-back" data-map-back hidden>戻る</button>`;
  app.prepend(root);
  let current: PrimaryView = "explore", mapReturn: PrimaryView = "explore", composing = false;
  const scrolls = new Map<string, number>();
  const textarea = root.querySelector<HTMLTextAreaElement>("#home-prompt")!;
  const draftKey = "raiquora:home-prompt-draft";
  try { textarea.value = window.sessionStorage.getItem(draftKey)?.slice(0, 400) ?? ""; } catch { /* Optional tab-local draft; never a Trip writer. */ }
  const saveDraft = () => { try { if (textarea.value) window.sessionStorage.setItem(draftKey, textarea.value.slice(0, 400)); else window.sessionStorage.removeItem(draftKey); } catch { /* Storage denial must not block conversation. */ } };
  textarea.addEventListener("input", saveDraft);
  textarea.addEventListener("compositionstart", () => { composing = true; });
  textarea.addEventListener("compositionend", () => { composing = false; });
  textarea.addEventListener("keydown", (event) => { if (event.key === "Enter" && (event.isComposing || composing)) event.stopPropagation(); });
  root.querySelector("form")!.addEventListener("submit", (event) => {
    event.preventDefault(); if (composing || !textarea.value.trim()) return;
    const prompt = textarea.value.trim(); textarea.value = ""; saveDraft(); navigate("chat"); ports.newConsultation(prompt);
  });
  root.querySelectorAll<HTMLButtonElement>("[data-example]").forEach((button) => button.addEventListener("click", () => { textarea.value = button.dataset.example!; saveDraft(); textarea.focus(); }));
  root.querySelector("[data-profile]")!.addEventListener("click", ports.openProfile);
  root.querySelector("[data-history]")!.addEventListener("click", ports.openHistory);
  root.querySelector("[data-settings]")!.addEventListener("click", ports.openSettings);
  root.querySelector("[data-notifications]")!.addEventListener("click", ports.openNotifications);
  const render = () => {
    let input: HomeReadInput;
    try { input = ports.read(); } catch { input = { state: "unavailable", trips: [], candidates: [] }; }
    const view = homeReadModel(input, ports.now());
    const stateText = view.state === "loading" ? "旅程を読み込んでいます。" : view.state === "unauthenticated" ? "公開の旅程保存は準備中です。相談はこのまま始められます。"
      : view.state === "unavailable" ? "旅程を取得できませんでした。未予約・準備完了とは判断していません。" : "次の旅はまだ決まっていません。相談から始めてみましょう。";
    root.querySelector("[data-home-live]")!.innerHTML = `${view.preview ? '<p class="preview-notice">開発preview・固定データです。保存されません。</p>' : ""}
      <section class="home-next"><h2>${view.next ? tripDisplayLabels[view.next.group] : "次の旅"}</h2>${view.next ? card(view.next.trip.id, view.next.trip.title, tripDisplayLabels[view.next.group]) : `<p role="status">${stateText}</p>`}
      ${view.state === "unavailable" ? '<button type="button" data-retry>再試行</button>' : ""}
      ${view.next ? `<p>${view.readiness?.preparation.readState === "available" ? `準備リストの未完了: ${view.readiness.preparation.categories.reduce((n, c) => n + c.open, 0)}件` : "準備リストは未取得です。"} ${view.readiness?.reservations.readState === "available" ? "予約状態は旅程の記録で確認してください。" : "予約状態は未確認です。"}</p>` : ""}</section>
      <section><h2>旅の候補</h2>${view.candidates.length ? `<div class="home-candidates">${view.candidates.map((c) => `<article class="home-card"><h3>${esc(c.title)}</h3><p>取得済みの範囲で移動を確認した候補です。未採用です。</p></article>`).join("")}</div>` : "<p>候補はまだ取得していません。上の相談例から、興味に合う場所を探せます。</p>"}
      <details><summary>対応範囲について</summary><p>収録駅・日付別時刻表と、駅からのアクセスを確認できる範囲をご案内します。未確認の場所も相談できます。</p></details></section>`;
    root.querySelector("[data-trip-list]")!.innerHTML = view.trips.length ? view.trips.map((row) => card(row.trip.id, row.trip.title, tripDisplayLabels[row.group])).join("") : `<p role="status">${stateText}</p>`;
    try {
      const profile = ports.profile(); root.querySelector("[data-profile-summary]")!.textContent = profile ? travelStyleSummary(profile) : "まだ設定していません。普段の好みを登録できます。";
    } catch { root.querySelector("[data-profile-summary]")!.textContent = "プロフィールを読み出せません。相談は登録なしでも利用できます。"; }
    root.querySelectorAll<HTMLButtonElement>("[data-trip]").forEach((button) => button.addEventListener("click", () => { navigate("chat"); ports.openTrip(button.dataset.trip!); }));
    root.querySelectorAll("[data-retry]").forEach((button) => button.addEventListener("click", () => { void ports.retry().then(render, render); }));
  };
  const apply = () => {
    const route = window.location.hash.slice(1);
    const previous = root.querySelector<HTMLElement>(`[data-page="${current}"]`); if (previous) scrolls.set(current, previous.scrollTop);
    const isMap = route === "map";
    if (["explore", "chat", "trips", "my"].includes(route)) current = route as PrimaryView;
    else if (!isMap) current = "explore";
    app.dataset.primaryView = isMap ? "map" : current;
    for (const page of root.querySelectorAll<HTMLElement>("[data-page]")) page.hidden = isMap || page.dataset.page !== current;
    root.querySelectorAll<HTMLElement>("[data-primary]").forEach((a) => { if (a.dataset.primary === (isMap ? mapReturn : current)) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    root.querySelector<HTMLElement>("[data-map-back]")!.hidden = !isMap;
    if (!isMap && current === "chat") ports.openChat();
    if (isMap) {
      const routeState = window.history.state;
      if (["explore", "chat", "trips", "my"].includes(routeState?.returnView)) mapReturn = routeState.returnView;
      ports.openMap(routeState?.mapMode === "simulation" ? "simulation" : "realtime");
    }
    const page = root.querySelector<HTMLElement>(`[data-page="${current}"]`); if (page) page.scrollTop = scrolls.get(current) ?? 0;
  };
  function navigate(view: PrimaryView) { window.history.pushState(null, "", `#${view}`); apply(); }
  root.querySelectorAll<HTMLAnchorElement>("[data-primary], .product-brand").forEach((link) => link.addEventListener("click", (event) => { event.preventDefault(); navigate(link.hash.slice(1) as PrimaryView); }));
  function showMap(mode: "realtime" | "simulation") {
    mapReturn = current; window.history.pushState({ returnView: current, mapMode: mode }, "", "#map"); apply();
  }
  root.querySelectorAll<HTMLButtonElement>("[data-map]").forEach((button) => button.addEventListener("click", () => showMap(button.dataset.map as "realtime" | "simulation")));
  root.querySelector("[data-map-back]")!.addEventListener("click", () => navigate(mapReturn));
  window.addEventListener("popstate", apply); window.addEventListener("hashchange", apply);
  document.addEventListener("transitforge:travel-profile-changed", render);
  ports.subscribe(render); render(); apply();
  return { navigate, showMap, refresh: render };
}
function esc(value: string): string { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
function card(id: string, title: string, group: string): string { return `<article class="home-card"><small>${esc(group)}</small><h3>${esc(title)}</h3><button type="button" data-trip="${esc(id)}">旅程を見る</button></article>`; }
