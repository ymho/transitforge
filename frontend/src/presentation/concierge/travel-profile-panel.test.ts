// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { configureTravelProfile, profileIntroductionGreeting } from "./travel-profile-panel";
import { ProfileUiController } from "../../usecases/personal-state/profile-ui-controller";
import type { ServerProfileClient } from "../../usecases/personal-state/server-profile-client";
import type { UserProfile } from "@raiquora/trip/travel-profile";

const profile: UserProfile = { version: 2, home: { station: "東京" }, companions: { usual: [], children: [] }, travelStyle: {}, preferences: {}, transport: {}, updatedAt: "2026-09-18T00:00:00Z" };
beforeEach(() => { document.body.innerHTML = '<main><section id="travel-profile-page"></section></main>'; });

describe("profileIntroductionGreeting", () => {
  it("夜間はこんばんはと案内する", () => {
    expect(profileIntroductionGreeting(new Date("2026-08-16T21:00:00"))).toBe("こんばんは");
    expect(profileIntroductionGreeting(new Date("2026-08-16T10:00:00"))).toBe("こんにちは");
  });
});

it("renders the editable form directly and saves with the current revision", async () => {
  const client: ServerProfileClient = { get: vi.fn(async () => ({ profile, revision: 3 })), update: vi.fn(async (next) => ({ profile: next, revision: 4 })), delete: vi.fn(async () => {}) };
  const controller = new ProfileUiController(client); await controller.hydrate(); configureTravelProfile(document, controller);
  expect(document.querySelector("[data-edit]")).toBeNull();
  const station = document.querySelector<HTMLInputElement>('[name="station"]')!; station.value = "上野"; station.dispatchEvent(new Event("input", { bubbles: true }));
  document.querySelector<HTMLFormElement>("#travel-profile-form")!.requestSubmit();
  await vi.waitFor(() => expect(client.update).toHaveBeenCalledOnce());
  expect(client.update).toHaveBeenCalledWith(expect.objectContaining({ home: expect.objectContaining({ station: "上野" }) }), 3);
  await vi.waitFor(() => expect(document.querySelector("[data-profile-message]")!.textContent).toContain("保存しました"));
});

it("blocks navigation while dirty and allows an explicit discard", () => {
  const client: ServerProfileClient = { get: vi.fn(), update: vi.fn(), delete: vi.fn() };
  configureTravelProfile(document, new ProfileUiController(client));
  document.querySelector<HTMLInputElement>('[name="station"]')!.dispatchEvent(new Event("input", { bubbles: true }));
  const leave = new Event("transitforge:profile-leave", { cancelable: true });
  expect(document.dispatchEvent(leave)).toBe(false);
  expect(document.querySelector<HTMLElement>("[data-discard]")!.hidden).toBe(false);
  document.querySelector<HTMLElement>("[data-discard]")!.click();
  expect(document.dispatchEvent(new Event("transitforge:profile-leave", { cancelable: true }))).toBe(true);
});
