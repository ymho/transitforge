// @vitest-environment happy-dom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { configureAiFirstShell, type AiFirstShellPorts } from "./ai-first-shell";
import { createServerTripListSource } from "../../usecases/trip-plan/server-trip-list-source";
import { createTrip } from "@raiquora/trip/trip";

beforeEach(() => { document.body.innerHTML = '<main id="app"></main>'; window.history.replaceState(null, "", "#chat"); sessionStorage.clear(); });
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
function setup(overrides: Partial<AiFirstShellPorts> = {}) {
  const ports: AiFirstShellPorts = {
    read: () => ({ state: "unauthenticated", trips: [] }),
    authState: () => ({ status: "signed-out" }), login: vi.fn(), logout: vi.fn(),
    subscribe: () => () => {}, retry: vi.fn(async () => {}), newConsultation: vi.fn(async () => {}), resetConsultation: vi.fn(), openChat: vi.fn(), openTrip: vi.fn(),
    openMap: vi.fn(), journeySettings: () => ({ transferPace: "standard", rankingPreference: "balanced" }), setJourneySettings: vi.fn(), openNotifications: vi.fn(), now: () => new Date("2026-09-18T00:00:00Z"), ...overrides,
  };
  return { shell: configureAiFirstShell(document, document.querySelector("main")!, ports), ports };
}
const click = (selector: string) => document.querySelector<HTMLElement>(selector)!.click();
it("places the profile settings target directly in the account page", () => {
  setup({ authState: () => ({ status: "signed-in", displayName: "山田 花子" }) });
  expect(document.querySelector("[data-profile]")).toBeNull();
  expect(document.querySelector("[data-page=my] #travel-profile-page")).not.toBeNull();
});
it("starts Home without initializing Map or requiring profile/authentication", () => {
  const { ports } = setup();
  expect(ports.openMap).not.toHaveBeenCalled(); expect(ports.newConsultation).not.toHaveBeenCalled();
  expect(document.body.textContent).not.toContain("調査済みのおすすめではありません");
  expect(document.querySelector('[aria-label="相談の入力例"]')).toBeNull();
  expect(document.querySelector(".home-rail-feature")).toBeNull();
  expect(document.querySelector("[data-home-live]")).toBeNull();
  const home = document.querySelector<HTMLElement>('[data-page="chat"]')!;
  expect(home.querySelector("h1")!.textContent).toContain("あなただけの旅を、一緒に形にします。");
  expect(home.textContent).not.toContain("旅の候補");
  expect(document.querySelector(".home-prompt")!.hasAttribute("hidden")).toBe(false);
  expect(document.querySelector(".home-prompt")!.classList.contains("ds-composer")).toBe(true);
  expect(document.querySelector("#home-prompt")!.classList.contains("ds-control")).toBe(true);
  expect(document.body.textContent).not.toContain("旅行相談を始めるにはログインしてください");
  expect(document.querySelector("[data-home-login]")).toBeNull();
  expect(document.querySelector('[data-primary="chat"]')!.hasAttribute("hidden")).toBe(false);
  const input = document.querySelector<HTMLTextAreaElement>("#home-prompt")!;
  input.value = "出雲へ行きたい"; input.dispatchEvent(new Event("input"));
  document.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
  expect(ports.login).toHaveBeenCalledOnce(); expect(ports.newConsultation).not.toHaveBeenCalled();
  expect(input.value).toBe("出雲へ行きたい");
  expect(sessionStorage.getItem("raiquora:home-prompt-draft")).toBe("出雲へ行きたい");
  expect(document.querySelector("main")!.dataset.primaryView).toBe("chat");
  expect(ports.openMap).not.toHaveBeenCalled();
});
it("loads saved trips only when the dedicated Trips screen is opened", () => {
  const retry = vi.fn(async () => {});
  const { shell } = setup({ authState: () => ({ status: "signed-in", displayName: "山田 花子" }), retry });
  expect(retry).not.toHaveBeenCalled();
  shell.navigate("trips");
  expect(retry).toHaveBeenCalledOnce();
});
it("starts consultation only after authentication and keeps a direct signed-out chat at its landing state", () => {
  window.history.replaceState(null, "", "#chat");
  const signedOut = setup();
  expect(document.querySelector("main")!.dataset.primaryView).toBe("chat");
  expect(signedOut.ports.openChat).not.toHaveBeenCalled();
  document.body.innerHTML = '<main id="app"></main>'; window.history.replaceState(null, "", "#chat");
  const signedIn = setup({ authState: () => ({ status: "signed-in", displayName: "山田 花子" }) });
  const input = document.querySelector<HTMLTextAreaElement>("#home-prompt")!; input.value = "温泉へ行きたい";
  document.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
  expect(signedIn.ports.newConsultation).toHaveBeenCalledWith("温泉へ行きたい");
  expect(document.querySelector("main")!.dataset.primaryView).toBe("chat");
});
it("puts the account icon in the shared navigation and sends signed-in people to My", () => {
  const signedOut = setup();
  expect(document.querySelector("[data-account] .ds-icon")).not.toBeNull();
  expect(document.querySelector(".product-header")).toBeNull();
  expect(document.querySelector(".product-brand .kaiho-logo")!.getAttribute("aria-label")).toBe("KAIHO");
  expect(document.querySelector(".product-nav [data-account]")!.textContent).toBe("設定");
  expect(document.querySelector("[data-account]")!.getAttribute("aria-label")).toBe("ログイン");
  click("[data-account]"); expect(signedOut.ports.login).toHaveBeenCalledOnce();
  document.body.innerHTML = '<main id="app"></main>';
  const signedIn = setup({ authState: () => ({ status: "signed-in", displayName: "山田 花子" }) });
  expect(document.querySelector("[data-account]")!.textContent).toBe("設定"); click("[data-account]");
  expect(document.querySelector('[data-page="my"]')!.getAttribute("aria-label")).toBe("設定");
  expect(document.querySelector("main")!.dataset.primaryView).toBe("my"); expect(document.querySelector("[data-my-account-status]")!.textContent).toContain("ログイン中");
  expect(document.querySelector("[data-account]")!.getAttribute("aria-current")).toBe("page");
  expect(document.querySelector("[data-my-account-status]")!.textContent).not.toContain("最大8時間");
  expect(document.querySelectorAll("[data-primary]")).toHaveLength(2);
  expect(document.querySelector('[data-primary="my"]')).toBeNull();
  click("[data-my-logout]"); expect(signedIn.ports.logout).toHaveBeenCalledOnce();
});

it("requires authentication before opening every feature route including realtime operations", () => {
  window.history.replaceState(null, "", "#map");
  const signedOut = setup();
  expect(document.querySelector("main")!.dataset.primaryView).toBe("chat");
  expect(window.location.hash).toBe("#chat");
  expect(signedOut.ports.openTrip).not.toHaveBeenCalled();
  click("[data-map]");
  expect(signedOut.ports.login).toHaveBeenCalledOnce();
  expect(signedOut.ports.openMap).not.toHaveBeenCalled();

  window.history.replaceState(null, "", "#my");
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  expect(document.querySelector("main")!.dataset.primaryView).toBe("chat");
});
it("shows one random western Japan hero photo without selection controls", () => {
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  setup();
  const images = [...document.querySelectorAll<HTMLImageElement>("[data-hero-image]")];
  expect(images).toHaveLength(3); expect(images[0]!.src).toContain("home-setouchi-v2.webp");
  expect(images.filter((image) => !image.hidden)).toHaveLength(1);
  expect(images[1]!.hidden).toBe(false);
  expect(document.querySelector("[data-hero-page]")).toBeNull();
});
it("places one short consultation example in the prompt placeholder", () => {
  vi.spyOn(Math, "random").mockReturnValue(0);
  setup();
  const example = document.querySelector<HTMLTextAreaElement>("#home-prompt")!;
  expect(example.placeholder).toBe("週末にしたいことは？");
  expect(document.querySelector("[data-example]")).toBeNull();
});
it("does not submit IME composition and keeps input across tab navigation / re-render", () => {
  const { ports, shell } = setup(); const input = document.querySelector("textarea")!;
  input.value = "日本語の入力途中"; input.dispatchEvent(new Event("input"));
  input.dispatchEvent(new CompositionEvent("compositionstart")); document.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
  expect(ports.newConsultation).not.toHaveBeenCalled();
  shell.navigate("my"); shell.navigate("chat"); shell.refresh(); expect(input.value).toBe("日本語の入力途中");
  expect(sessionStorage.getItem("raiquora:home-prompt-draft")).toBe(input.value);
});
it("map is a realtime-only subview and source tab survives history restoration", () => {
  const { shell, ports } = setup({ authState: () => ({ status: "signed-in", displayName: "山田 花子" }) }); shell.navigate("trips"); shell.showMap();
  expect(ports.openMap).toHaveBeenCalledExactlyOnceWith();
  expect(document.querySelector('[data-primary="trips"]')!.hasAttribute("aria-current")).toBe(false);
  expect(document.querySelector("[data-map-navigation]")!.getAttribute("aria-current")).toBe("page");
  expect(window.history.state).toEqual({ returnView: "trips" });
  expect(document.querySelector("[data-map-back]")).toBeNull();
  click('[data-primary="trips"]'); expect(document.querySelector("main")!.dataset.primaryView).toBe("trips");
});
it("opens realtime operations from the persistent navigation and marks it current", () => {
  const { ports } = setup({ authState: () => ({ status: "signed-in", displayName: "山田 花子" }) }); click("[data-map-navigation]");
  expect(ports.openMap).toHaveBeenCalledExactlyOnceWith();
  expect(document.querySelector("main")!.dataset.primaryView).toBe("map");
  expect(document.querySelector("[data-map-navigation]")!.getAttribute("aria-current")).toBe("page");
});
it.each(["loading", "available", "unavailable", "unauthenticated"] as const)("keeps read state out of Home and reports it only in the Trips surface (%s)", (state) => {
  const signedIn = state === "unauthenticated" ? { status: "signed-out" as const } : { status: "signed-in" as const, displayName: "山田 花子" };
  const { shell } = setup({ authState: () => signedIn, read: () => ({ state, trips: [] }) });
  expect(document.querySelector("[data-home-live]")).toBeNull();
  if (signedIn.status === "signed-in") {
    shell.navigate("trips");
    expect(document.querySelector("[data-trip-list]")!.textContent).not.toContain("予約済み");
    expect(document.querySelector("[data-trip-list]")!.textContent).not.toContain("準備完了です");
  }
});
it("reader failures do not disable the independent Home consultation form", () => {
  setup({ read: () => { throw new Error("unavailable"); } });
  expect(document.querySelector("[data-home-live]")).toBeNull();
  expect(document.querySelector<HTMLButtonElement>('.home-prompt button')!.disabled).toBe(false);
});
it("all secondary actions use existing feature ports", () => {
  const { shell, ports } = setup({ authState: () => ({ status: "signed-in", displayName: "山田 花子" }) }); shell.navigate("my");
  click("[data-notifications]");
  expect(ports.openNotifications).toHaveBeenCalledOnce();
});
it("opens the actual Trip as a trips subview, not a selected chat tab", async () => {
  const trip = createTrip("45300000-0000-4000-8000-000000000001", "旅程", "2026-09-18T00:00:00Z", []);
  const { ports } = setup({ authState: () => ({ status: "signed-in", displayName: "山田 花子" }), read: () => ({ state: "available", trips: [trip] }) });
  expect(document.querySelector('.trip-list-cover[aria-hidden="true"] img')).not.toBeNull();
  click('[data-primary="trips"]'); click("[data-trip]");
  expect(document.querySelector("main")!.dataset.primaryView).toBe("trip-loading");
  await vi.waitFor(() => expect(document.querySelector("main")!.dataset.primaryView).toBe("trip"));
  expect(document.querySelector('[data-primary="trips"]')!.getAttribute("aria-current")).toBe("page");
  expect(document.querySelector('[data-primary="chat"]')!.hasAttribute("aria-current")).toBe(false);
  expect(ports.openTrip).toHaveBeenCalledWith(trip.id);
  expect(window.location.hash).toBe("#trip");
  click('[data-primary="trips"]');
  expect(document.querySelector<HTMLElement>('[data-page="trips"]')!.hidden).toBe(false);
});
it("shows a travel-mode entry only for the current adopted Trip", () => {
  const base = createTrip("45300000-0000-4000-8000-000000000001", "今日の旅", "2026-09-18T00:00:00Z", [{
    id: "now", title: "現在の予定", type: "activity", category: "sightseeing",
    schedule: { type: "fixed", startAt: { at: "2026-09-17T23:00:00Z", timeZone: "UTC" }, endAt: { at: "2026-09-18T01:00:00Z", timeZone: "UTC" } },
  }]);
  const trip = { ...base, adoption: { confirmedAt: "2026-09-17T00:00:00Z" } };
  const openTravelMode = vi.fn(); const { shell } = setup({ authState: () => ({ status: "signed-in", displayName: "山田 花子" }), read: () => ({ state: "available", trips: [trip] }), openTravelMode });
  shell.navigate("trips"); click("[data-trip-travel]"); expect(openTravelMode).toHaveBeenCalledWith(trip.id);
  expect(document.querySelectorAll("[data-trip-travel]")).toHaveLength(1);
});

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

it("does not start a queued Trip restore after the user already selected a new consultation", async () => {
  window.history.replaceState({ consultation: "trip", tripId: "trip-one" }, "", "#chat");
  const consultTrip = vi.fn(async () => {});
  const { shell, ports } = setup({ authState: signedIn, consultTrip });
  shell.navigate("chat");
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(consultTrip).not.toHaveBeenCalled(); expect(ports.openChat).not.toHaveBeenCalled();
  expect(document.querySelector("main")!.dataset.consultationMode).toBe("landing");
  expect(window.history.state.tripId).toBeUndefined();
});

it("retains the current creation attempt across a failed submit and binds its successful route to the new Trip", async () => {
  const tripId = "75300000-0000-4000-8000-000000000001";
  const newConsultation = vi.fn().mockRejectedValueOnce(new Error("uncertain start")).mockResolvedValue({ tripId });
  const { ports } = setup({ authState: signedIn, newConsultation });
  const resets = vi.mocked(ports.resetConsultation).mock.calls.length;
  const input = document.querySelector<HTMLTextAreaElement>("#home-prompt")!;
  const form = document.querySelector<HTMLFormElement>(".home-prompt")!; input.value = "出雲大社へ";
  form.dispatchEvent(new Event("submit", { cancelable: true }));
  await vi.waitFor(() => expect(document.querySelector("main")!.dataset.consultationMode).toBe("landing"));
  expect(input.value).toBe("出雲大社へ");
  form.dispatchEvent(new Event("submit", { cancelable: true }));
  await vi.waitFor(() => expect(document.querySelector("main")!.dataset.consultationMode).toBe("conversation"));
  expect(ports.resetConsultation).toHaveBeenCalledTimes(resets);
  expect(history.state).toMatchObject({ consultation: "trip", tripId });
  expect(ports.openChat).toHaveBeenCalledOnce();
});

it.each(["/", "/index.html", "/#chat", "/#trip", "/#map", "/#my"])("mounts the actual signed-out Source and shell at %s without recursive notifications", path => {
  window.history.replaceState(null, "", path);
  const list = vi.fn(), source = createServerTripListSource({ list }, () => false);
  const { shell, ports } = setup({ read: () => ({ state: source.getState(), trips: source.getTrips() }), subscribe: source.subscribe });
  expect(document.querySelector("main")!.dataset.primaryView).toBe("chat");
  expect(window.location.hash).toBe("#chat");
  expect(document.querySelector<HTMLElement>("[data-home-hero]")!.hidden).toBe(false);
  expect(ports.openMap).not.toHaveBeenCalled(); expect(list).not.toHaveBeenCalled();
  shell.refresh(); shell.dispose(); source.dispose();
});

it("rotates prompt examples in order and preserves typed input", () => {
  vi.useFakeTimers();
  const { shell } = setup();
  const input = document.querySelector<HTMLTextAreaElement>("#home-prompt")!;
  vi.advanceTimersByTime(4000); expect(input.placeholder).toBe("来週、出雲大社にいきたい");
  vi.advanceTimersByTime(4000); expect(input.placeholder).toBe("リラックスできる旅を提案して");
  input.value = "入力中"; vi.advanceTimersByTime(4000); expect(input.value).toBe("入力中"); expect(input.placeholder).toBe("リラックスできる旅を提案して");
  input.value = ""; vi.advanceTimersByTime(4000); expect(input.placeholder).toBe("週末にしたいことは？");
  shell.dispose(); vi.useRealTimers();
});

it("keeps a Trip behind the loading status until activation finishes, fences cancelled navigation and reports failure", async () => {
  const trip = createTrip("45300000-0000-4000-8000-000000000001", "旅程", "2026-09-18T00:00:00Z", []);
  let complete!: () => void;
  const openTrip = vi.fn(() => new Promise<void>(resolve => { complete = resolve; }));
  const { shell } = setup({ authState: () => ({ status: "signed-in", displayName: "検証" }), read: () => ({ state: "available", trips: [trip] }), openTrip });
  shell.navigate("trips"); click("[data-trip]");
  shell.showTrip(trip.id); // History restoration can publish before navigation finishes.
  expect(document.querySelector("main")!.dataset.primaryView).toBe("trip-loading");
  expect(document.querySelector('[data-trip-route-progress] .ds-spinner')).not.toBeNull();
  shell.navigate("my"); complete(); await Promise.resolve(); await Promise.resolve();
  expect(document.querySelector("main")!.dataset.primaryView).toBe("my");
  openTrip.mockRejectedValueOnce(new Error("offline")); shell.navigate("trips"); click("[data-trip]");
  await vi.waitFor(() => expect(document.querySelector('[data-trip-route-progress]')!.textContent).toContain("読み込めませんでした"));
  expect(document.querySelector('[data-trip-route-progress] .ds-spinner')).toBeNull();
});

it("resumes a submitted prompt once after the login redirect, but never auto-sends an ordinary draft", async () => {
  const before = setup();
  document.querySelector<HTMLTextAreaElement>("#home-prompt")!.value = "出雲へ行きたい";
  document.querySelector<HTMLFormElement>(".home-prompt")!.requestSubmit();
  before.shell.dispose();
  const after = setup({ authState: () => ({ status: "signed-in", displayName: "テスト" }) });
  await vi.waitFor(() => expect(after.ports.openChat).toHaveBeenCalledOnce());
  expect(after.ports.newConsultation).toHaveBeenCalledExactlyOnceWith("出雲へ行きたい");
  after.shell.refresh();
  expect(after.ports.newConsultation).toHaveBeenCalledOnce();
  expect(sessionStorage.getItem("raiquora:home-prompt-submit")).toBeNull();
  after.shell.dispose();
  sessionStorage.setItem("raiquora:home-prompt-draft", "まだ送っていない相談");
  const draft = setup({ authState: () => ({ status: "signed-in", displayName: "テスト" }) });
  expect(draft.ports.newConsultation).not.toHaveBeenCalled();
});

it("consumes the pending send on authentication notification without retrying a failed start", async () => {
  let signedIn = false, notify = () => {};
  const start = vi.fn(async () => { throw new Error("unavailable"); });
  const f = setup({ authState: () => signedIn ? { status: "signed-in", displayName: "テスト" } : { status: "signed-out" }, subscribe: listener => { notify = listener; return () => {}; }, newConsultation: start });
  document.querySelector<HTMLTextAreaElement>("#home-prompt")!.value = "京都へ";
  document.querySelector<HTMLFormElement>(".home-prompt")!.requestSubmit();
  signedIn = true; notify(); notify();
  await vi.waitFor(() => expect(document.body.textContent).toContain("相談を開始できませんでした"));
  notify(); expect(start).toHaveBeenCalledExactlyOnceWith("京都へ");
  expect(document.querySelector<HTMLTextAreaElement>("#home-prompt")!.value).toBe("京都へ");
  f.shell.dispose();
});

it("dismisses trip menus outside their own bounds and unregisters on dispose", () => {
  const trip = createTrip("45300000-0000-4000-8000-000000000001", "旅程", "2026-09-18T00:00:00Z", []);
  const { shell } = setup({ authState: () => ({ status: "signed-in", displayName: "検証" }), read: () => ({ state: "available", trips: [trip] }) });
  shell.navigate("trips");
  const menu = document.querySelector<HTMLDetailsElement>(".home-trip-manage")!;
  menu.open = true; menu.querySelector("summary")!.dispatchEvent(new Event("click", { bubbles: true })); expect(menu.open).toBe(true);
  document.body.click(); expect(menu.open).toBe(false);
  const header = document.createElement("details"); header.className = "trip-header-management";
  document.querySelector("main")!.append(header); header.open = true;
  document.body.click(); expect(header.open).toBe(false);
  shell.dispose(); header.open = true; document.body.click(); expect(header.open).toBe(true);
});

it("shows an out-of-scope reply without opening a conversation or losing the original prompt", async () => {
  const message = "旅行やお出かけの相談をお手伝いできます。";
  const { ports } = setup({ authState: signedIn, newConsultation: vi.fn(async () => ({ message })) });
  const input = document.querySelector<HTMLTextAreaElement>("#home-prompt")!; input.value = "積分の公式を教えて";
  document.querySelector(".home-prompt")!.dispatchEvent(new Event("submit", { cancelable: true }));
  await vi.waitFor(() => expect(document.querySelector("main")!.dataset.consultationMode).toBe("landing"));
  expect(document.querySelector("[data-consultation-error]")?.textContent).toBe(message);
  expect(input.value).toBe("積分の公式を教えて"); expect(input.disabled).toBe(false);
  expect(ports.openChat).not.toHaveBeenCalled(); expect(ports.openTrip).not.toHaveBeenCalled();
});
