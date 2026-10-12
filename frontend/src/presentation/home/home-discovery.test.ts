// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { configureHomeDiscovery, type HomeTheme } from "./home-discovery";

it("keeps editorial prompts unsent, uses local images and binds real feature navigation", () => {
  const topics = document.createElement("div"), services = document.createElement("div");
  const choosePrompt = vi.fn(async () => {}), trips = vi.fn(), map = vi.fn();
  const discovery = configureHomeDiscovery(topics, services, { now: () => new Date("2026-10-13T00:00:00Z"), choosePrompt, trips, map });
  expect(topics.querySelectorAll("[data-home-theme]")).toHaveLength(3);
  expect([...topics.querySelectorAll("img")].every(image => image.getAttribute("src")?.startsWith("/media/"))).toBe(true);
  expect(choosePrompt).not.toHaveBeenCalled();
  topics.querySelector<HTMLButtonElement>("[data-home-theme]")!.click(); expect(choosePrompt).toHaveBeenCalledOnce();
  services.querySelector<HTMLButtonElement>(".home-service-banner button")!.click(); expect(trips).toHaveBeenCalledOnce();
  services.querySelector<HTMLButtonElement>(".home-service-link")!.click(); expect(map).toHaveBeenCalledOnce();
  expect(services.textContent).toContain("旅程への追加は予約ではありません"); discovery.dispose();
});

it("hides empty, scheduled, expired and invalid-date slots and refreshes publication windows", () => {
  const topics = document.createElement("div"), services = document.createElement("div");
  let now = new Date("2026-10-13T00:00:00Z");
  const base: HomeTheme = { id: "period", title: "期間限定の編集枠", description: "説明", image: "/media/home-izumo-v2.webp", prompt: "相談", from: "2026-10-14T00:00:00Z", until: "2026-10-15T00:00:00Z" };
  const f = configureHomeDiscovery(topics, services, { now: () => now, choosePrompt: vi.fn(), trips: vi.fn(), map: vi.fn() }, [base, { ...base, id: "bad", from: "invalid" }]);
  expect(topics.hidden).toBe(true);
  now = new Date("2026-10-14T00:00:00Z"); f.refresh(); expect(topics.hidden).toBe(false); expect(topics.querySelectorAll("button")).toHaveLength(1);
  now = new Date("2026-10-15T00:00:00Z"); f.refresh(); expect(topics.hidden).toBe(true); f.dispose();
});
