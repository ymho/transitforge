// @vitest-environment happy-dom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { configureAiFirstShell, type AiFirstShellPorts } from "./ai-first-shell";
import { createTrip } from "@raiquora/trip/trip";

beforeEach(() => { document.body.innerHTML = '<main id="app"></main>'; window.history.replaceState(null, "", "#explore"); sessionStorage.clear(); });
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
function setup(overrides: Partial<AiFirstShellPorts> = {}) {
  const ports: AiFirstShellPorts = {
    read: () => ({ state: "unauthenticated", trips: [], candidates: [] }),
    authState: () => ({ status: "signed-out" }), login: vi.fn(), logout: vi.fn(),
    subscribe: () => () => {}, retry: vi.fn(async () => {}), newConsultation: vi.fn(), openChat: vi.fn(), openTrip: vi.fn(),
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
  expect(document.querySelector('[aria-label="相談の入力例"]')).not.toBeNull();
  expect(document.querySelector("[data-home-live]")!.textContent).toContain("ログインすると、保存した旅程");
  expect(document.querySelector(".home-prompt")!.hasAttribute("hidden")).toBe(true);
  expect(document.querySelector('[data-primary="chat"]')!.hasAttribute("hidden")).toBe(true);
  click("[data-example]"); document.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
  expect(ports.login).toHaveBeenCalledOnce(); expect(ports.newConsultation).not.toHaveBeenCalled();
  expect(document.querySelector("main")!.dataset.primaryView).toBe("explore");
  expect(ports.openMap).not.toHaveBeenCalled();
});
it("starts consultation only after authentication and rejects a direct signed-out chat route", () => {
  window.history.replaceState(null, "", "#chat");
  const signedOut = setup();
  expect(document.querySelector("main")!.dataset.primaryView).toBe("explore");
  expect(signedOut.ports.openChat).not.toHaveBeenCalled();
  document.body.innerHTML = '<main id="app"></main>'; window.history.replaceState(null, "", "#explore");
  const signedIn = setup({ authState: () => ({ status: "signed-in", displayName: "山田 花子" }) });
  const input = document.querySelector<HTMLTextAreaElement>("#home-prompt")!; input.value = "温泉へ行きたい";
  document.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
  expect(signedIn.ports.newConsultation).toHaveBeenCalledWith("温泉へ行きたい");
  expect(document.querySelector("main")!.dataset.primaryView).toBe("chat");
});
it("uses an account icon in the header and sends signed-in people to My", () => {
  const signedOut = setup();
  expect(document.querySelector("[data-account] .ds-icon")).not.toBeNull();
  expect(document.querySelector("[data-account]")!.textContent).toBe("");
  expect(document.querySelector("[data-account]")!.getAttribute("aria-label")).toBe("ログインまたは新規登録");
  click("[data-account]"); expect(signedOut.ports.login).toHaveBeenCalledOnce();
  document.body.innerHTML = '<main id="app"></main>';
  const signedIn = setup({ authState: () => ({ status: "signed-in", displayName: "山田 花子" }) });
  expect(document.querySelector("[data-account]")!.textContent).toBe(""); click("[data-account]");
  expect(document.querySelector("main")!.dataset.primaryView).toBe("my"); expect(document.querySelector("[data-my-account-status]")!.textContent).toContain("ログイン中");
  expect(document.querySelector("[data-my-account-status]")!.textContent).not.toContain("最大8時間");
  expect(document.querySelectorAll("[data-primary]")).toHaveLength(3);
  expect(document.querySelector('[data-primary="my"]')).toBeNull();
  click("[data-my-logout]"); expect(signedIn.ports.logout).toHaveBeenCalledOnce();
});
it("shows three western Japan hero photos and switches them only on explicit selection", () => {
  setup();
  const images = [...document.querySelectorAll<HTMLImageElement>("[data-hero-image]")];
  expect(images).toHaveLength(3); expect(images[0]!.src).toContain("home-setouchi-v2.webp");
  expect(images[0]!.hidden).toBe(false); expect(images[1]!.hidden).toBe(true);
  click('[data-hero-page="1"]');
  expect(images[0]!.hidden).toBe(true); expect(images[1]!.hidden).toBe(false);
  expect(document.querySelector('[data-hero-page="1"]')!.getAttribute("aria-current")).toBe("true");
});
it("does not submit IME composition and keeps input across tab navigation / re-render", () => {
  const { ports, shell } = setup(); const input = document.querySelector("textarea")!;
  input.value = "日本語の入力途中"; input.dispatchEvent(new Event("input"));
  input.dispatchEvent(new CompositionEvent("compositionstart")); document.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
  expect(ports.newConsultation).not.toHaveBeenCalled();
  shell.navigate("my"); shell.navigate("explore"); shell.refresh(); expect(input.value).toBe("日本語の入力途中");
  expect(sessionStorage.getItem("raiquora:home-prompt-draft")).toBe(input.value);
});
it("map is a subview; requested simulation and source tab survive history restoration", () => {
  const { shell, ports } = setup({ authState: () => ({ status: "signed-in", displayName: "山田 花子" }) }); shell.navigate("trips"); shell.showMap("simulation");
  expect(ports.openMap).toHaveBeenCalledExactlyOnceWith("simulation");
  expect(document.querySelector('[data-primary="trips"]')!.hasAttribute("aria-current")).toBe(false);
  expect(document.querySelector("[data-map-navigation]")!.getAttribute("aria-current")).toBe("page");
  expect(window.history.state).toEqual({ returnView: "trips", mapMode: "simulation" });
  click("[data-map-back]"); expect(document.querySelector("main")!.dataset.primaryView).toBe("trips");
});
it("opens realtime operations from the persistent navigation and marks it current", () => {
  const { ports } = setup(); click("[data-map-navigation]");
  expect(ports.openMap).toHaveBeenCalledExactlyOnceWith("realtime");
  expect(document.querySelector("main")!.dataset.primaryView).toBe("map");
  expect(document.querySelector("[data-map-navigation]")!.getAttribute("aria-current")).toBe("page");
});
it.each(["loading", "available", "unavailable", "unauthenticated"] as const)("renders %s without inventing reservations or completion", (state) => {
  setup({ read: () => ({ state, trips: [], candidates: [] }) });
  const text = document.querySelector("[data-home-live]")!.textContent!;
  expect(text).not.toContain("予約済み"); expect(text).not.toContain("準備完了です");
  expect(document.querySelector("[data-retry]") !== null).toBe(state === "unavailable");
});
it("reader failures render retry without disabling the independent consultation form", () => {
  setup({ read: () => { throw new Error("unavailable"); } });
  expect(document.querySelector("[data-retry]")).not.toBeNull();
  expect(document.querySelector<HTMLButtonElement>('form button')!.disabled).toBe(false);
});
it("all secondary actions use existing feature ports", () => {
  const { shell, ports } = setup(); shell.navigate("my");
  click("[data-notifications]");
  expect(ports.openNotifications).toHaveBeenCalledOnce();
});
it("opens the actual Trip as a trips subview, not a selected chat tab", () => {
  const trip = createTrip("45300000-0000-4000-8000-000000000001", "旅程", "2026-09-18T00:00:00Z", []);
  const { ports } = setup({ authState: () => ({ status: "signed-in", displayName: "山田 花子" }), read: () => ({ state: "available", trips: [trip], candidates: [] }) });
  expect(document.querySelector('.home-trip-art svg[aria-hidden="true"]')).not.toBeNull();
  click('[data-primary="trips"]'); click("[data-trip]");
  expect(document.querySelector("main")!.dataset.primaryView).toBe("trip");
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
  const openTravelMode = vi.fn(); setup({ read: () => ({ state: "available", trips: [trip], candidates: [] }), openTravelMode });
  click("[data-trip-travel]"); expect(openTravelMode).toHaveBeenCalledWith(trip.id);
  expect(document.querySelectorAll("[data-trip-travel]")).toHaveLength(1);
});
