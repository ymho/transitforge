// @vitest-environment happy-dom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { configureAiFirstShell, type AiFirstShellPorts } from "./ai-first-shell";
import { createTrip } from "@raiquora/trip/trip";

beforeEach(() => { document.body.innerHTML = '<main id="app"></main>'; window.history.replaceState(null, "", "#explore"); sessionStorage.clear(); });
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
function setup(overrides: Partial<AiFirstShellPorts> = {}) {
  const ports: AiFirstShellPorts = {
    read: () => ({ state: "unauthenticated", trips: [], candidates: [] }), profile: () => undefined,
    authState: () => ({ status: "signed-out" }), login: vi.fn(), logout: vi.fn(),
    subscribe: () => () => {}, retry: vi.fn(async () => {}), newConsultation: vi.fn(), openChat: vi.fn(), openTrip: vi.fn(),
    openProfile: vi.fn(), openMap: vi.fn(), journeySettings: () => ({ transferPace: "standard", rankingPreference: "balanced" }), setJourneySettings: vi.fn(), openNotifications: vi.fn(), now: () => new Date("2026-09-18T00:00:00Z"), ...overrides,
  };
  return { shell: configureAiFirstShell(document, document.querySelector("main")!, ports), ports };
}
const click = (selector: string) => document.querySelector<HTMLElement>(selector)!.click();
it("shows real Profile choices as bounded chips, not fixed mock preferences", () => {
  setup({ profile: () => ({ version: 2, home: {}, companions: { usual: [], children: [] }, travelStyle: { pace: .2 },
    preferences: { food: .9, history: .9, sea: .1 }, transport: { preferredMode: "rail" }, updatedAt: "2026-09-18T00:00:00Z" }) });
  expect([...document.querySelectorAll("[data-profile-summary] span")].map((e) => e.textContent)).toEqual(["列車を優先", "ゆったり", "食", "歴史"]);
  expect(document.querySelector("[data-profile-summary]")!.textContent).not.toContain("海");
});
it("starts Home without initializing Map or requiring profile/authentication", () => {
  const { ports } = setup();
  expect(ports.openMap).not.toHaveBeenCalled(); expect(ports.newConsultation).not.toHaveBeenCalled();
  expect(document.body.textContent).not.toContain("調査済みのおすすめではありません");
  expect(document.querySelector('[aria-label="相談の入力例"]')).not.toBeNull();
  expect(document.querySelector("[data-home-live]")!.textContent).toContain("ログインすると、保存した旅程");
  click("[data-example]"); document.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
  expect(ports.newConsultation).toHaveBeenCalledWith("のんびりできる旅を考えたい");
  expect(document.querySelector("main")!.dataset.primaryView).toBe("chat");
  expect(ports.openMap).not.toHaveBeenCalled();
});
it("keeps login visible in the header and sends signed-in people to My", () => {
  const signedOut = setup();
  expect(document.querySelector("[data-account]")!.textContent).toBe("ログイン / 新規登録"); click("[data-account]"); expect(signedOut.ports.login).toHaveBeenCalledOnce();
  document.body.innerHTML = '<main id="app"></main>';
  const signedIn = setup({ authState: () => ({ status: "signed-in", displayName: "山田 花子" }) });
  expect(document.querySelector("[data-account]")!.textContent).toBe("山田 花子"); click("[data-account]");
  expect(document.querySelector("main")!.dataset.primaryView).toBe("my"); expect(document.querySelector("[data-my-account-status]")!.textContent).toContain("ログイン中");
  click("[data-my-logout]"); expect(signedIn.ports.logout).toHaveBeenCalledOnce();
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
  const { shell, ports } = setup(); shell.navigate("my"); shell.showMap("simulation");
  expect(ports.openMap).toHaveBeenCalledExactlyOnceWith("simulation");
  expect(document.querySelector('[data-primary="my"]')!.getAttribute("aria-current")).toBe("page");
  expect(window.history.state).toEqual({ returnView: "my", mapMode: "simulation" });
  click("[data-map-back]"); expect(document.querySelector("main")!.dataset.primaryView).toBe("my");
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
  for (const key of ["profile", "notifications"]) click(`[data-${key}]`);
  expect(ports.openProfile).toHaveBeenCalledOnce();
  expect(ports.openNotifications).toHaveBeenCalledOnce();
});
it("opens the actual Trip as a trips subview, not a selected chat tab", () => {
  const trip = createTrip("45300000-0000-4000-8000-000000000001", "旅程", "2026-09-18T00:00:00Z", []);
  const { ports } = setup({ read: () => ({ state: "available", trips: [trip], candidates: [] }) });
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
