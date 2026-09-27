// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { configureTravelProfile, profileIntroductionGreeting } from "./travel-profile-panel";
import { ProfileUiController } from "../../usecases/personal-state/profile-ui-controller";
import type { ServerProfileClient } from "../../usecases/personal-state/server-profile-client";
import type { UserProfile } from "@raiquora/trip/travel-profile";

const profile: UserProfile = { version: 3, usualOrigin: "東京", interests: ["history"], considerations: "歩きすぎない", updatedAt: "2026-09-18T00:00:00Z" };
beforeEach(() => { document.body.innerHTML = '<main><section id="travel-profile-page"></section></main>'; });
describe("profileIntroductionGreeting", () => {
  it("時間帯に応じて挨拶する", () => {
    expect(profileIntroductionGreeting(new Date("2026-08-16T21:00:00"))).toBe("こんばんは");
    expect(profileIntroductionGreeting(new Date("2026-08-16T10:00:00"))).toBe("こんにちは");
  });
});
it("shows exactly the three optional profile concepts and autosaves origin", async () => {
  vi.useFakeTimers();
  const update = vi.fn(async (next: UserProfile) => ({ profile: next, revision: 4 }));
  const client: ServerProfileClient = { get: vi.fn(async () => ({ profile, revision: 3 })), update, delete: vi.fn(async () => {}) };
  const controller = new ProfileUiController(client); await controller.hydrate(); configureTravelProfile(document, controller);
  expect(document.body.textContent).toContain("普段の出発地");
  expect(document.body.textContent).toContain("好きなこと");
  expect(document.body.textContent).toContain("いつも配慮してほしいこと");
  expect(document.body.textContent).not.toMatch(/普段の人数|子どもの年代|予算|ペース|移動上限|宿泊の好み/);
  const origin = document.querySelector<HTMLInputElement>('[name="usualOrigin"]')!;
  origin.value = "上野"; origin.dispatchEvent(new Event("input", { bubbles: true })); origin.focus();
  await vi.advanceTimersByTimeAsync(400); await vi.waitFor(() => expect(update).toHaveBeenCalledOnce());
  expect(update).toHaveBeenCalledWith(expect.objectContaining({ version: 3, usualOrigin: "上野", interests: ["history"], considerations: "歩きすぎない" }), 3);
  expect(Object.keys(update.mock.calls[0]![0]).sort()).toEqual(["considerations","interests","updatedAt","usualOrigin","version"]);
  expect(document.activeElement).toBe(origin); vi.useRealTimers();
});
it("saves interests immediately and does not create Trip-specific fields", async () => {
  const update = vi.fn(async (next: UserProfile) => ({ profile: next, revision: 4 }));
  const controller = new ProfileUiController({ get: vi.fn(async () => ({ profile, revision: 3 })), update, delete: vi.fn(async () => {}) });
  await controller.hydrate(); configureTravelProfile(document, controller);
  const food = document.querySelector<HTMLInputElement>('input[name="interest"][value="food"]')!;
  food.checked = true; food.dispatchEvent(new Event("input", { bubbles: true }));
  await vi.waitFor(() => expect(update).toHaveBeenCalledOnce());
  expect(update.mock.calls[0]![0].interests).toEqual(["history","food"]);
  expect(JSON.stringify(update.mock.calls[0]![0])).not.toMatch(/companions|budget|travelStyle|transport|party/);
});
it("keeps failed text visible and retries", async () => {
  vi.useFakeTimers();
  const update = vi.fn().mockRejectedValueOnce(new Error("offline")).mockImplementation(async (next: UserProfile) => ({ profile: next, revision: 4 }));
  const controller = new ProfileUiController({ get: vi.fn(async () => ({ profile, revision: 3 })), update, delete: vi.fn(async () => {}) });
  await controller.hydrate(); configureTravelProfile(document, controller);
  const text = document.querySelector<HTMLTextAreaElement>('[name="considerations"]')!;
  text.value = "静かな宿が好き"; text.dispatchEvent(new Event("input", { bubbles: true }));
  await vi.advanceTimersByTimeAsync(400); await vi.waitFor(() => expect(document.querySelector("[data-profile-message]")!.textContent).toContain("保存できません"));
  expect(text.value).toBe("静かな宿が好き");
  document.querySelector<HTMLButtonElement>("[data-profile-retry]")!.click();
  await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(2)); vi.useRealTimers();
});
it("does not autosave during IME composition", async () => {
  vi.useFakeTimers();
  const update = vi.fn(async (next: UserProfile) => ({ profile: next, revision: 4 }));
  const controller = new ProfileUiController({ get: vi.fn(async () => ({ profile, revision: 3 })), update, delete: vi.fn(async () => {}) });
  await controller.hydrate(); configureTravelProfile(document, controller);
  const origin = document.querySelector<HTMLInputElement>('[name="usualOrigin"]')!;
  origin.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })); origin.value = "入力途中"; origin.dispatchEvent(new Event("input", { bubbles: true }));
  await vi.advanceTimersByTimeAsync(500); expect(update).not.toHaveBeenCalled();
  origin.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })); await vi.advanceTimersByTimeAsync(400);
  await vi.waitFor(() => expect(update).toHaveBeenCalledOnce()); vi.useRealTimers();
});
