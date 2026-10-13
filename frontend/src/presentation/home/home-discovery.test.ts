// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { configureHomeDiscovery, type HomeTheme } from "./home-discovery";

it("starts only a selected theme or campaign and binds real feature navigation", async () => {
  const topics = document.createElement("div"), services = document.createElement("div");
  const choosePrompt = vi.fn(async () => {}), trips = vi.fn(), map = vi.fn();
  const discovery = configureHomeDiscovery(topics, services, { now: () => new Date("2026-10-13T00:00:00Z"), choosePrompt, trips, map });
  expect(topics.querySelectorAll("[data-home-theme]")).toHaveLength(6);
  expect(topics.querySelectorAll("[data-home-campaign]")).toHaveLength(3);
  expect(new Set([...topics.querySelectorAll("img")].map(image => image.src)).size).toBe(9);
  expect([...topics.querySelectorAll("img")].every(image => image.getAttribute("src")?.startsWith("/media/"))).toBe(true);
  expect(choosePrompt).not.toHaveBeenCalled();
  topics.querySelector<HTMLButtonElement>("[data-home-theme]")!.click(); expect(choosePrompt).toHaveBeenCalledOnce();
  await Promise.resolve(); await Promise.resolve();
  topics.querySelector<HTMLButtonElement>("[data-home-campaign=rail]")!.click(); expect(choosePrompt).toHaveBeenLastCalledWith(expect.stringContaining("列車旅"));
  services.querySelector<HTMLButtonElement>(".home-service-banner button")!.click(); expect(trips).toHaveBeenCalledOnce();
  services.querySelector<HTMLButtonElement>(".home-service-link")!.click(); expect(map).toHaveBeenCalledOnce();
  expect(services.textContent).toContain("旅程への追加は予約ではありません"); discovery.dispose();
});

it("hides empty, scheduled, expired and invalid-date slots and refreshes publication windows", () => {
  const topics = document.createElement("div"), services = document.createElement("div");
  let now = new Date("2026-10-13T00:00:00Z");
  const base: HomeTheme = { id: "period", title: "期間限定の編集枠", description: "説明", image: "/media/home-izumo-v2.webp", prompt: "相談", from: "2026-10-14T00:00:00Z", until: "2026-10-15T00:00:00Z" };
  const f = configureHomeDiscovery(topics, services, { now: () => now, choosePrompt: vi.fn(), trips: vi.fn(), map: vi.fn() }, [base, { ...base, id: "bad", from: "invalid" }], []);
  expect(topics.hidden).toBe(true);
  now = new Date("2026-10-14T00:00:00Z"); f.refresh(); expect(topics.hidden).toBe(false); expect(topics.querySelectorAll("button")).toHaveLength(1);
  now = new Date("2026-10-15T00:00:00Z"); f.refresh(); expect(topics.hidden).toBe(true); f.dispose();
});

it("ignores repeat theme and campaign clicks while the selected consultation is starting", async () => {
  const topics = document.createElement("div"), services = document.createElement("div");
  let complete!: () => void;
  const choosePrompt = vi.fn(() => new Promise<void>(resolve => { complete = resolve; }));
  const f = configureHomeDiscovery(topics, services, { now: () => new Date(), choosePrompt, trips: vi.fn(), map: vi.fn() });
  topics.querySelector<HTMLButtonElement>("[data-home-theme]")!.click();
  f.refresh();
  topics.querySelector<HTMLButtonElement>("[data-home-campaign]")!.click();
  expect(choosePrompt).toHaveBeenCalledOnce();
  complete(); await Promise.resolve(); await Promise.resolve();
  expect([...topics.querySelectorAll<HTMLButtonElement>("button")].every(button => !button.disabled)).toBe(true);
  f.dispose();
});
