// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { configureTravelProfile, profileIntroductionGreeting } from "./travel-profile-panel";
import { ProfileUiController } from "../../usecases/personal-state/profile-ui-controller";
import type { ServerProfileClient } from "../../usecases/personal-state/server-profile-client";
import type { UserProfile } from "@raiquora/trip/travel-profile";

const profile: UserProfile = { version: 2, home: { station: "東京" }, companions: { usual: ["family"], children: [{ ageGroup: "elementary" }], usualPartySize: 4 },
  travelStyle: { novelty: .8 }, preferences: {}, transport: { maxTypicalTravelMinutes: 120 }, notes: { budget: "旧予算" }, aiNoteFields: ["budget"], updatedAt: "2026-09-18T00:00:00Z" };
beforeEach(() => { document.body.innerHTML = '<main><section id="travel-profile-page"></section></main>'; });

describe("profileIntroductionGreeting", () => {
  it("夜間はこんばんはと案内する", () => {
    expect(profileIntroductionGreeting(new Date("2026-08-16T21:00:00"))).toBe("こんばんは");
    expect(profileIntroductionGreeting(new Date("2026-08-16T10:00:00"))).toBe("こんにちは");
  });
});

it("autosaves text with the current revision without replacing the focused form", async () => {
  vi.useFakeTimers();
  const client: ServerProfileClient = { get: vi.fn(async () => ({ profile, revision: 3 })), update: vi.fn(async (next) => ({ profile: next, revision: 4 })), delete: vi.fn(async () => {}) };
  const controller = new ProfileUiController(client); await controller.hydrate(); configureTravelProfile(document, controller);
  expect(document.querySelector('[type="submit"]')).toBeNull();
  expect(document.querySelector(".profile-editor-actions")).toBeNull();
  expect(document.querySelectorAll("[data-profile-section]")).toHaveLength(5);
  expect(document.body.textContent).not.toMatch(/普段の人数|子どもの年代|普段の予算感|移動上限|行き先（定番/);
  const station = document.querySelector<HTMLInputElement>('[name="station"]')!; station.value = "上野"; station.dispatchEvent(new Event("input", { bubbles: true }));
  station.focus();
  expect(client.update).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(400);
  await vi.waitFor(() => expect(client.update).toHaveBeenCalledOnce());
  expect(client.update).toHaveBeenCalledWith(expect.objectContaining({ home: expect.objectContaining({ station: "上野" }),
    companions: profile.companions, travelStyle: expect.objectContaining({ novelty: .8 }),
    transport: expect.objectContaining({ maxTypicalTravelMinutes: 120 }), notes: expect.objectContaining({ budget: "旧予算" }) }), 3);
  await vi.waitFor(() => expect(document.querySelector("[data-profile-message]")!.textContent).toContain("保存済み"));
  expect(document.activeElement).toBe(station);
  vi.useRealTimers();
});

it("saves discrete controls immediately, keeps consent off, and opening a section does not save", async () => {
  const update = vi.fn(async (next: UserProfile) => ({ profile: next, revision: 3 }));
  const client: ServerProfileClient = { get: vi.fn(async () => ({ profile: { ...profile, aiNoteFields: [] }, revision: 2 })),
    update, delete: vi.fn(async () => {}) };
  const controller = new ProfileUiController(client); await controller.hydrate(); configureTravelProfile(document, controller);
  const interests = document.querySelectorAll<HTMLDetailsElement>("[data-profile-section]")[1]!;
  interests.open = true; interests.dispatchEvent(new Event("toggle"));
  expect(client.update).not.toHaveBeenCalled();
  document.querySelector<HTMLButtonElement>('[data-choice="interest-food"]')!.click();
  await vi.waitFor(() => expect(client.update).toHaveBeenCalledOnce());
  expect(client.update).toHaveBeenCalledWith(expect.objectContaining({ preferences: { food: .9 } }), 2);
  expect(update.mock.calls[0]![0].aiNoteFields).toBeUndefined();
});

it("keeps a failed draft visible and retries without a permanent save button", async () => {
  vi.useFakeTimers();
  const update = vi.fn().mockRejectedValueOnce(new Error("offline")).mockImplementation(async (next: UserProfile) => ({ profile: next, revision: 4 }));
  const client: ServerProfileClient = { get: vi.fn(async () => ({ profile, revision: 3 })), update, delete: vi.fn(async () => {}) };
  const controller = new ProfileUiController(client); await controller.hydrate(); configureTravelProfile(document, controller);
  const station = document.querySelector<HTMLInputElement>('[name="station"]')!; station.value = "上野"; station.dispatchEvent(new Event("input", { bubbles: true }));
  await vi.advanceTimersByTimeAsync(400); await vi.waitFor(() => expect(document.querySelector("[data-profile-message]")!.textContent).toContain("保存できません"));
  expect(station.value).toBe("上野"); expect(document.querySelector<HTMLButtonElement>("[data-profile-retry]")!.hidden).toBe(false);
  document.querySelector<HTMLButtonElement>("[data-profile-retry]")!.click();
  await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(document.querySelector("[data-profile-message]")!.textContent).toContain("保存済み"));
  vi.useRealTimers();
});

it("waits for IME composition and cancels a pending draft on account clear", async () => {
  vi.useFakeTimers();
  const client: ServerProfileClient = { get: vi.fn(async () => ({ profile, revision: 3 })), update: vi.fn(async (next) => ({ profile: next, revision: 4 })), delete: vi.fn(async () => {}) };
  const controller = new ProfileUiController(client); await controller.hydrate(); configureTravelProfile(document, controller);
  const station = document.querySelector<HTMLInputElement>('[name="station"]')!;
  station.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  station.value = "入力途中"; station.dispatchEvent(new Event("input", { bubbles: true }));
  await vi.advanceTimersByTimeAsync(500); expect(client.update).not.toHaveBeenCalled();
  station.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  controller.clear();
  await vi.advanceTimersByTimeAsync(500);
  expect(client.update).not.toHaveBeenCalled();
  expect(document.querySelector<HTMLInputElement>('[name="station"]')!.value).toBe("");
  vi.useRealTimers();
});
