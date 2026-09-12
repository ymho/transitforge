// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { configureTravelProfile } from "./travel-profile-panel";
import { loadUserProfile, travelProfileChangedEvent, travelProfileStorageKey } from "../../usecases/trip-profile/user-profile-repository";

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<button id="travel-profile-toggle"></button><dialog id="travel-profile-dialog"></dialog>';
});
afterEach(() => { document.body.replaceChildren(); localStorage.clear(); vi.restoreAllMocks(); });

function click(selector: string): void {
  const button = document.querySelector<HTMLButtonElement>(selector);
  expect(button, selector).not.toBeNull();
  button!.click();
}
function fillProfile(): void {
  const input = document.querySelector<HTMLInputElement>('[name="home"]')!;
  input.value = "京都駅";
  for (let step = 0; step < 7; step++) click('[type="submit"]');
}

it("プロフィール保存から選定待機なしでスタイル確認と会話開始へ進む", () => {
  const completed = vi.fn();
  const changed = vi.fn();
  document.addEventListener(travelProfileChangedEvent, changed, { once: true });
  const setTimeout = vi.spyOn(window, "setTimeout");
  configureTravelProfile(document, localStorage, completed);
  const dialog = document.querySelector<HTMLDialogElement>("dialog")!;
  expect(dialog.open).toBe(true);
  click("[data-begin]");
  fillProfile();
  expect(dialog.textContent).toContain("あなたの旅のスタイル");
  expect(dialog.querySelector("img")).toBeNull();
  expect(dialog.textContent).not.toContain("探しています");
  expect(dialog.querySelector("[data-match-continue]")).toBeNull();
  expect(setTimeout).not.toHaveBeenCalled();
  expect(changed).toHaveBeenCalledOnce();
  expect(loadUserProfile(localStorage)?.home.station).toBe("京都駅");
  expect(completed).not.toHaveBeenCalled();
  click("[data-start]");
  expect(dialog.open).toBe(false);
  expect(completed).toHaveBeenCalledOnce();
});

it("登録済みプロフィールの起動・再編集で会話や旅程を変更しない", () => {
  configureTravelProfile(document, localStorage);
  click("[data-begin]");
  fillProfile();
  const saved = localStorage.getItem(travelProfileStorageKey);
  // Existing records (including historical character names) are opaque to this UI.
  localStorage.setItem("transitforge.concierge-history.v3", '[{"text":"ナギとの過去の会話"}]');
  localStorage.setItem("saved-trip-fixture", '{"id":"trip-1"}');
  document.body.innerHTML = '<button id="travel-profile-toggle"></button><dialog id="travel-profile-dialog"></dialog>';
  const completed = vi.fn();
  configureTravelProfile(document, localStorage, completed);
  const dialog = document.querySelector<HTMLDialogElement>("dialog")!;
  expect(dialog.open).toBe(false);
  expect(localStorage.getItem(travelProfileStorageKey)).toBe(saved);
  click("#travel-profile-toggle");
  expect(dialog.textContent).toContain("あなたの旅のスタイル");
  click("[data-edit]");
  expect(document.querySelector<HTMLInputElement>('[name="home"]')?.value).toBe("京都駅");
  fillProfile();
  click("[data-start]");
  expect(completed).toHaveBeenCalledOnce();
  expect(localStorage.getItem("transitforge.concierge-history.v3")).toBe('[{"text":"ナギとの過去の会話"}]');
  expect(localStorage.getItem("saved-trip-fixture")).toBe('{"id":"trip-1"}');
});
