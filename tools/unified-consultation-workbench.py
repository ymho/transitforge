from pathlib import Path

# One-shot, branch-local source editing. No cloud calls, credentials or user data.
def edit(path, old, new):
    file = Path(path)
    text = file.read_text()
    if text.count(old) != 1:
        raise RuntimeError(f'Expected one edit anchor in {path}: {old[:90]!r}')
    file.write_text(text.replace(old, new, 1))

def replace_region(path, start, end, replacement):
    file = Path(path)
    text = file.read_text()
    a, b = text.index(start), text.index(end, text.index(start))
    file.write_text(text[:a] + replacement + text[b:])

shell = 'frontend/src/presentation/home/ai-first-shell.ts'
edit(shell, 'export type PrimaryView = "explore" | "chat" | "trips" | "my";', 'export type PrimaryView = "chat" | "trips" | "my";')
edit(shell, '  newConsultation(prompt: string): void;', '  newConsultation(prompt: string): Promise<void>;\n  resetConsultation(): void;\n  cancelNavigation?(): void;')
edit(shell, '  consultTrip?(id: string): void;', '  consultTrip?(id: string): Promise<void> | void;')
edit(shell, '[["explore", "探す", "explore"], ["chat", "相談", "chat"], ["trips", "旅程", "trips"]]', '[["chat", "相談", "chat"], ["trips", "旅程", "trips"]]')
edit(shell, 'data-page="explore" aria-label="探す"', 'data-page="chat" aria-label="相談"')
edit(shell, '    </div></div></section>\n    <section class="product-page" data-page="trips"', '    <p class="consultation-entry-error" data-consultation-error role="status" hidden></p></div></div><div class="consultation-entry-progress" data-consultation-progress hidden><p role="status" data-consultation-status></p><button type="button" data-consultation-retry hidden>再試行</button></div></section>\n    <section class="product-page" data-page="trips"')
edit(shell, '  let current: PrimaryView = "explore", composing = false;', '  let current: PrimaryView = "chat", composing = false;\n  let consultationMode: "landing" | "starting" | "conversation" | "unavailable" = "landing";\n  let entryGeneration = 0, appliedRoute = "";')
replace_region(shell, '  homeForm.addEventListener("submit",', '  root.querySelector("[data-account]")', '''  homeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (composing || consultationMode === "starting" || !textarea.value.trim()) return;
    if (!isSignedIn()) { saveDraft(); ports.login(); return; }
    if (!canNavigate()) return;
    const prompt = textarea.value.trim(), generation = ++entryGeneration;
    ports.resetConsultation();
    entryError.textContent = "";
    consultationMode = "starting";
    entryStatus.textContent = "相談を始めています。";
    replaceRoute("chat", { consultation: "active" });
    try {
      await ports.newConsultation(prompt);
      if (generation !== entryGeneration || !root.isConnected || !isSignedIn()) return;
      textarea.value = ""; saveDraft();
      consultationMode = "conversation"; paintRoute(); ports.openChat();
    } catch {
      if (generation !== entryGeneration || !root.isConnected) return;
      consultationMode = "landing";
      entryError.textContent = "相談を開始できませんでした。入力は残しています。もう一度送信してください。";
      replaceRoute("chat", { consultation: "new" });
    }
  });
''')
edit(shell, '    for (const view of ["chat", "trips"])', '    for (const view of ["trips"])')
replace_region(shell, '    root.querySelectorAll<HTMLButtonElement>("[data-trip-chat]")', '    root.querySelectorAll<HTMLButtonElement>("[data-trip-travel]")', '')
edit(shell, '      window.history.pushState({ tripId: button.dataset.trip! }, "", "#trip"); apply();', '      if (!canNavigate()) return;\n      window.history.pushState({ tripId: button.dataset.trip! }, "", "#trip"); apply();')
edit(shell, '    if (signedIn && window.location.hash === "#trip" && typeof window.history.state?.tripId === "string") ports.openTrip(window.history.state.tripId);\n    if (!signedIn && current !== "explore") { window.history.replaceState(null, "", "#explore"); apply(); }', '    if (!signedIn && (window.location.hash !== "#chat" || consultationMode !== "landing")) {\n      window.history.replaceState({ consultation: "new" }, "", "#chat"); apply(true);\n    }')
edit(shell, '    let input: HomeReadInput;', '    if (!root.isConnected) return;\n    let input: HomeReadInput;')
replace_region(shell, '  const apply = () => {', '\n}\nfunction esc', '''  const hero = root.querySelector<HTMLElement>("[data-home-hero]")!;
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
    app.dataset.primaryView = isMap ? "map" : isTrip ? "trip" : current;
    app.dataset.consultationMode = consultationMode;
    hero.hidden = consultationMode !== "landing";
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
    if (window.location.hash !== "#trip") window.history.pushState({ tripId }, "", "#trip");
    else window.history.replaceState({ tripId }, "", "#trip");
    appliedRoute = routeKey(); paintRoute();
  }
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
    ports.cancelNavigation?.();
    if (route === "chat") {
      const tripId = window.history.state?.consultation === "trip" ? window.history.state?.tripId : undefined;
      if (isSignedIn() && typeof tripId === "string" && ports.consultTrip) {
        consultationMode = "starting"; entryStatus.textContent = "この旅の相談を読み込んでいます。"; paintRoute();
        void Promise.resolve().then(() => ports.consultTrip!(tripId)).then(() => {
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
      paintRoute();
      if (route === "trips") void ports.retry();
      if (route === "trip" && typeof window.history.state?.tripId === "string") ports.openTrip(window.history.state.tripId);
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
  const unsubscribe = ports.subscribe(render); render(); apply();
  return { navigate, showMap, showConversation, showTrip, refresh: render, dispose() {
    ++entryGeneration; unsubscribe();
    window.removeEventListener("popstate", historyChanged); window.removeEventListener("hashchange", historyChanged);
    document.removeEventListener("transitforge:travel-profile-changed", render); root.remove();
  } };
''')
edit(shell, '<button type="button" data-trip-chat="${esc(trip.id)}">AIに相談</button>', '')

composition = 'frontend/src/composition/viewer-composition.ts'
edit(composition, 'const pendingConsultationKey = "raiquora:pending-consultation";\n', '')
edit(composition, '''    activeConversationSession = (await conversationUi.hydrate()) ?? await conversationUi.create();
    await conversationUi.loadHistory(activeConversationSession.id);
    activeConversationSession = conversationUi.active() ?? activeConversationSession;
    await profileUi.hydrate();''', '''    // No standalone-chat restoration or empty server conversation at startup.
    await profileUi.hydrate();''')
edit(composition, '  if (app.dataset.primaryView === "map") primaryShell?.navigate("chat");', '''  if (app.dataset.primaryView === "map") {
    if (conversationUi.active()) primaryShell?.showConversation(activeConversationSession.tripId);
    else primaryShell?.navigate("chat");
  }''')
edit(composition, '  showContext: (view) => contextWorkspaceController.show(view), returnToConversation,', '''  showContext: (view) => contextWorkspaceController.show(view), returnToConversation,
  onViewChange: (view) => {
    const trip = tripWorkspaceController.current();
    if (view === "trip" && trip) primaryShell?.showTrip(trip.id);
    else if (view === "chat") primaryShell?.showConversation(trip?.id);
  },''')
replace_region(composition, 'const startNewConsultation = async (prompt: string) => {', 'let initialAuthenticationNotification', '''const resetConsultation = () => {
  tripNavigation.cancel(); conversationUi.clear();
  activeConversationSession = { ...unsignedConversation, id: `ui-new-${crypto.randomUUID()}` };
  serverAgentSession.contextChanged();
  tripWorkspaceController.activateSession(activeConversationSession.id);
  contextWorkspaceController.activateSession(activeConversationSession.id);
  aiGuideController.switchSession(activeConversationSession.id);
};
const startNewConsultation = async (prompt: string) => {
  if (!isSignedIn()) throw new Error("Authentication required");
  await createAndActivateConversation();
  aiGuideController.ask(prompt);
};
''')
replace_region(composition, '  void Promise.all([conversationUi.hydrate(), profileUi.hydrate()])', '\n});\nconfigureApplicationSettingsPanel', '''  void profileUi.hydrate().catch(() => {
    if (generation === authenticationGeneration) profileUi.clear();
  });''')
replace_region(composition, 'if (isSignedIn()) {\n  try {\n    const pending = sessionStorage.getItem(pendingConsultationKey)', '\napplyContextWorkspaceState();', '')
edit(composition, '  newConsultation: (prompt) => { void startNewConsultation(prompt).catch(() => aiGuideController.notify("相談を始めるにはログインしてください。")); },', '''  newConsultation: startNewConsultation,
  resetConsultation,
  cancelNavigation: () => { tripNavigation.cancel(); },''')
edit(composition, '  consultTrip: (id) => { void tripNavigation.open(id, "chat").catch(() => aiGuideController.notify("対象の旅程を読み込めませんでした。")); },', '  consultTrip: (id) => tripNavigation.open(id, "chat"),')
edit(composition, '  newConversation: () => { void createAndActivateConversation().then(() => aiGuideController.open()).catch(() => aiGuideController.notify("相談を始めるにはログインしてください。")); },', '  newConversation: () => { primaryShell?.navigate("chat"); },')

workspace = 'frontend/src/presentation/trip-plan/trip-workspace.ts'
edit(workspace, '  ask(prompt: string): void; nextItemId(): string;', '  ask(prompt: string): void; nextItemId(): string;\n  onViewChange?(view: "chat" | "trip"): void;')
edit(workspace, '  heading.append(emblem, title, notice, summary, openTravelMode);', '''  const openConsultation = control("この旅について相談", () => show("chat"));
  openConsultation.dataset.tripConsultation = "";
  heading.append(emblem, title, notice, summary, openConsultation, openTravelMode);''')
edit(workspace, '    app.dataset.tripWorkspaceView = view;', '    app.dataset.tripWorkspaceView = view;\n    options.onViewChange?.(view);')
edit(workspace, '    openTravelMode.hidden = !trip;', '    openTravelMode.hidden = openConsultation.hidden = !trip;')

css = Path('frontend/src/presentation/home/product-shell.css')
css.write_text(css.read_text().replace('[data-page="explore"]', '[data-page="chat"]') + '''
/* One consultation route; the hero is its empty state, never a second menu page. */
#app[data-primary-view="chat"]:not([data-consultation-mode="conversation"]) :is(.consultation-page, .ai-guide-panel, .trip-workspace, .trip-workspace-navigation) { display: none; }
.consultation-entry-error { max-width: 42rem; margin: .75rem 1rem; padding: .5rem .75rem; border-radius: .5rem; background: var(--product-paper); }
.consultation-entry-progress { min-height: 70svh; display: grid; place-content: center; justify-items: center; gap: .75rem; padding: 5rem 1rem; }
.consultation-entry-progress[hidden], .consultation-entry-error[hidden], .home-hero[hidden] { display: none; }
''')
edit('frontend/src/presentation/home/consultation-screen.ts', 'const conditions = node("button", "consultation-conditions-toggle", "この旅の条件"), tripButton = node("button", "", "旅程を見る");', 'const conditions = node("button", "consultation-conditions-toggle", "この旅の条件"), tripButton = node("button", "", "旅程に戻る");')

# Preserve existing feature tests; revise only the removed Explore/restore contract.
tests = Path('frontend/src/presentation/home/ai-first-shell.test.ts')
s = tests.read_text().replace('#explore', '#chat').replace('"explore"', '"chat"')
s = s.replace('newConsultation: vi.fn(), openChat:', 'newConsultation: vi.fn(async () => {}), resetConsultation: vi.fn(), openChat:')
s = s.replace('expect(document.querySelectorAll("[data-primary]")).toHaveLength(3);', 'expect(document.querySelectorAll("[data-primary]")).toHaveLength(2);')
s = s.replace('expect(document.querySelector(\'[data-primary="chat"]\')!.hasAttribute("hidden")).toBe(true);', 'expect(document.querySelector(\'[data-primary="chat"]\')!.hasAttribute("hidden")).toBe(false);')
s = s.replace('starts consultation only after authentication and rejects a direct signed-out chat route', 'starts consultation only after authentication and keeps a direct signed-out chat at its landing state')
s += '''
const signedIn = () => ({ status: "signed-in" as const, displayName: "テスト" });
it("unifies the menu and uses a fresh hero entry even when a prior chat was active", async () => {
  const { shell, ports } = setup({ authState: signedIn });
  expect([...document.querySelectorAll(".product-nav a, .product-nav button")].map(x => x.textContent)).toEqual(["相談", "旅程", "運行", "設定"]);
  expect(document.querySelector('[data-page="explore"]')).toBeNull();
  expect(document.querySelector("main")!.dataset.consultationMode).toBe("landing");
  expect(ports.newConsultation).not.toHaveBeenCalled();
  shell.showConversation("trip-one");
  expect(document.querySelector<HTMLElement>("[data-home-hero]")!.hidden).toBe(true);
  const before = vi.mocked(ports.resetConsultation).mock.calls.length;
  click('[data-primary="chat"]');
  expect(ports.resetConsultation).toHaveBeenCalledTimes(before + 1);
  expect(window.history.state.tripId).toBeUndefined();
  expect(document.querySelector<HTMLElement>("[data-home-hero]")!.hidden).toBe(false);
});
it("sends the unchanged prompt exactly once, leaves the hero and does not double-open on history events", async () => {
  let complete!: () => void;
  const newConsultation = vi.fn(() => new Promise<void>(resolve => { complete = resolve; }));
  const { ports } = setup({ authState: signedIn, newConsultation });
  const input = document.querySelector<HTMLTextAreaElement>("#home-prompt")!;
  input.value = "出雲大社に行きたい";
  const form = document.querySelector<HTMLFormElement>(".home-prompt")!;
  form.dispatchEvent(new Event("submit", { cancelable: true }));
  form.dispatchEvent(new Event("submit", { cancelable: true }));
  expect(newConsultation).toHaveBeenCalledExactlyOnceWith("出雲大社に行きたい");
  expect(document.querySelector("main")!.dataset.consultationMode).toBe("starting");
  expect(document.querySelector<HTMLElement>("[data-home-hero]")!.hidden).toBe(true);
  complete(); await vi.waitFor(() => expect(document.querySelector("main")!.dataset.consultationMode).toBe("conversation"));
  window.dispatchEvent(new PopStateEvent("popstate")); window.dispatchEvent(new HashChangeEvent("hashchange"));
  expect(newConsultation).toHaveBeenCalledTimes(1); expect(ports.openChat).toHaveBeenCalledOnce();
  expect(input.value).toBe("");
});
it("keeps the hero prompt and reports a failed start without showing an old conversation", async () => {
  setup({ authState: signedIn, newConsultation: vi.fn(async () => { throw new Error("offline"); }) });
  const input = document.querySelector<HTMLTextAreaElement>("#home-prompt")!; input.value = "まだ入力を残す";
  document.querySelector(".home-prompt")!.dispatchEvent(new Event("submit", { cancelable: true }));
  await vi.waitFor(() => expect(document.querySelector("main")!.dataset.consultationMode).toBe("landing"));
  expect(input.value).toBe("まだ入力を残す"); expect(input.disabled).toBe(false);
  expect(document.querySelector<HTMLElement>("[data-consultation-error]")!.hidden).toBe(false);
});
it("does not let a late new-conversation response override a newer navigation", async () => {
  let complete!: () => void;
  const { shell, ports } = setup({ authState: signedIn, newConsultation: vi.fn(() => new Promise<void>(resolve => { complete = resolve; })) });
  document.querySelector<HTMLTextAreaElement>("#home-prompt")!.value = "新しい相談";
  document.querySelector(".home-prompt")!.dispatchEvent(new Event("submit", { cancelable: true }));
  shell.navigate("trips"); complete(); await Promise.resolve(); await Promise.resolve();
  expect(document.querySelector("main")!.dataset.primaryView).toBe("trips"); expect(ports.openChat).not.toHaveBeenCalled();
});
it("opens a trip consultation without the hero and restores only its explicitly referenced trip", async () => {
  window.history.replaceState({ consultation: "trip", tripId: "trip-one" }, "", "#chat");
  const consultTrip = vi.fn(async () => {});
  const { shell, ports } = setup({ authState: signedIn, consultTrip });
  expect(document.querySelector<HTMLElement>("[data-home-hero]")!.hidden).toBe(true);
  await vi.waitFor(() => expect(consultTrip).toHaveBeenCalledExactlyOnceWith("trip-one"));
  await vi.waitFor(() => expect(document.querySelector("main")!.dataset.consultationMode).toBe("conversation"));
  expect(ports.newConsultation).not.toHaveBeenCalled();
  shell.showTrip("trip-one"); expect(window.location.hash).toBe("#trip");
  shell.showConversation("trip-one"); expect(window.location.hash).toBe("#chat");
  expect(document.querySelector<HTMLElement>("[data-home-hero]")!.hidden).toBe(true);
  expect(consultTrip).toHaveBeenCalledTimes(1);
});
it("keeps a failed trip consultation separate from new-chat hero and supports retry", async () => {
  window.history.replaceState({ consultation: "trip", tripId: "trip-one" }, "", "#chat");
  const consultTrip = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
  setup({ authState: signedIn, consultTrip });
  await vi.waitFor(() => expect(document.querySelector("main")!.dataset.consultationMode).toBe("unavailable"));
  expect(document.querySelector<HTMLElement>("[data-home-hero]")!.hidden).toBe(true);
  click("[data-consultation-retry]");
  await vi.waitFor(() => expect(document.querySelector("main")!.dataset.consultationMode).toBe("conversation"));
  expect(consultTrip).toHaveBeenCalledTimes(2);
});
'''
tests.write_text(s)

# A real workspace-to-shell composition test, not a scripted model-answer assertion.
Path('frontend/src/presentation/home/consultation-navigation.integration.test.ts').write_text('''// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { createTrip } from "@raiquora/trip/trip";
import { createTripWorkspaceController } from "../../usecases/trip-plan/trip-workspace-controller";
import { configureTripWorkspace } from "../trip-plan/trip-workspace";
import { configureAiFirstShell } from "./ai-first-shell";

afterEach(() => document.body.replaceChildren());
it("uses the same consultation surface from Trip, returns to Trip, and makes the menu a fresh entry", () => {
  document.body.innerHTML = '<main id="app"><section id="chat"><ol></ol><input></section></main>';
  window.history.replaceState(null, "", "#chat");
  const app = document.querySelector<HTMLElement>("main")!, chat = document.querySelector<HTMLElement>("#chat")!;
  const trip = createTrip("45300000-0000-4000-8000-000000000001", "出雲旅行", "2026-09-27T00:00:00Z");
  const controller = createTripWorkspaceController("trip-conversation"), ask = vi.fn();
  controller.attach("trip-conversation", { getCurrentTrip: () => trip });
  let workspace: ReturnType<typeof configureTripWorkspace>;
  const shell = configureAiFirstShell(document, app, {
    read: () => ({ state: "available", trips: [trip] }), authState: () => ({ status: "signed-in", displayName: "テスト" }),
    subscribe: () => () => {}, login: vi.fn(), logout: vi.fn(), retry: vi.fn(async () => {}),
    newConsultation: vi.fn(async () => {}), resetConsultation: vi.fn(), openChat: vi.fn(), openMap: vi.fn(),
    openTrip: () => workspace.show("trip"), journeySettings: () => ({ transferPace: "standard", rankingPreference: "balanced" }),
    setJourneySettings: vi.fn(), openNotifications: vi.fn(), now: () => new Date("2026-09-27T00:00:00Z"),
  });
  workspace = configureTripWorkspace({ app, chat, messages: chat.querySelector("ol")!, input: chat.querySelector("input")!, controller,
    ask, showContext: vi.fn(), returnToConversation: vi.fn(), showMap: vi.fn(), nextItemId: () => "new-item",
    onViewChange: view => view === "trip" ? shell.showTrip(trip.id) : shell.showConversation(trip.id),
  });
  shell.navigate("trips"); document.querySelector<HTMLButtonElement>("[data-trip]")!.click();
  expect(app.dataset.primaryView).toBe("trip"); expect(document.querySelector("[data-trip-chat]")).toBeNull();
  document.querySelector<HTMLButtonElement>("[data-trip-consultation]")!.click();
  expect(app.dataset.primaryView).toBe("chat"); expect(app.dataset.consultationMode).toBe("conversation");
  expect(window.history.state.tripId).toBe(trip.id); expect(ask).not.toHaveBeenCalled();
  expect(controller.sessionId()).toBe("trip-conversation");
  workspace.show("trip"); expect(app.dataset.primaryView).toBe("trip");
  shell.navigate("chat"); expect(app.dataset.consultationMode).toBe("landing"); expect(window.history.state.tripId).toBeUndefined();
  shell.dispose();
});
''')

Path('docs/architecture/unified-consultation-entry.md').write_text('''# 相談の入口と旅程からの継続相談

## 画面契約

主要メニューは「相談・旅程・運行・設定」の4項目。探すを独立した画面・routeにしない。
`#chat`が共通の相談画面で、新規時だけ従来の写真Heroとcomposerを表示する。
利用者が送信すると新しいServer Conversationを作成して通常の相談へ移る。未送信の文字入力やIME変換だけでは画面を切り替えない。
未ログイン送信は入力を保持して認証へ進む。未認証で会話・旅程・運行APIを利用しない。

起動・再読み込み・メニューの相談・新規相談ボタンでは、過去の一般チャットを自動選択しない。
初期画面表示だけで空のServer Conversationを作らない。既存履歴の移行・互換routeは用意しない。

## 旅程の相談

旅程一覧から旅程を開き、旅程画面の「この旅について相談」で同じ相談画面へ移る。Heroは出さない。
相談の「旅程に戻る」で同じTripの画面へ戻す。会話は既存の認証済みTrip参照から取得し、別のTripや直近チャットへfallbackしない。
履歴へ戻る操作でTripの相談を復元する場合も、明示されたTrip参照を再認可・取得する。
URLにTrip本文・owner・認証情報を含めず、現在の画面参照だけをhistory stateに置く。

## 実装境界

Shellはroute/landing/開始中/会話/取得失敗を管理する。Trip workspaceの表示切替はShellへ通知するだけで再取得や新規会話作成を再帰実行しない。
新規相談の作成完了はawaitし、二重送信・別画面へ移動後の遅延完了・認証変更を隔離する。
開始失敗時はHeroの入力を保持する。Trip取得失敗時はHeroへ戻さず対象の再試行を示す。

今回の変更は入口と表示連携。プロフィール3項目化、Trip中心の新保存モデル、履歴付き分岐、目的別Toolは別の改修単位であり、実装済みとはしない。
Agentモデル・prompt・実行上限・保存済みTripへの操作契約・IAMは変更しない。

## 検証

`ai-first-shell.test.ts`で4メニュー、Heroからの送信、IME、認証、二重送信、失敗時の入力保持、遅延完了とTrip参照復元を検証する。
`consultation-navigation.integration.test.ts`で実Trip workspaceとShellを組み、旅程→相談→旅程→新規Heroを確認する。
通常CIのTypeScript全体テスト・architecture・buildおよびV2 Acceptance/Smokeも確認する。
''')
print('Applied unified consultation source/tests/documentation patches.')
