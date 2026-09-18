// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { configureTravelProfile } from "./travel-profile-panel";
import { loadUserProfile, saveUserProfile, travelProfileChangedEvent, travelProfileStorageKey } from "../../usecases/trip-profile/user-profile-repository";

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<button id="travel-profile-toggle"></button><dialog id="travel-profile-dialog"></dialog>';
});
afterEach(() => { document.body.replaceChildren(); localStorage.clear(); vi.restoreAllMocks(); });
function click(selector: string): void { const node = document.querySelector<HTMLButtonElement>(selector); expect(node, selector).not.toBeNull(); node!.click(); }
function input(name: string, value: string): void {
  const node = document.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  node.value = value; node.dispatchEvent(new Event("input", { bubbles: true }));
}
function edit(): void { click("#travel-profile-toggle"); click("[data-edit]"); }

it("does not require registration and lets an unregistered user start consulting", () => {
  const completed = vi.fn(); configureTravelProfile(document, localStorage, completed);
  expect(document.querySelector<HTMLDialogElement>("dialog")!.open).toBe(false);
  click("#travel-profile-toggle"); expect(document.body.textContent).toContain("設定せずに相談できます");
  click("[data-start]"); expect(completed).toHaveBeenCalledOnce(); expect(loadUserProfile(localStorage)).toBeUndefined();
});

it("saves only explicit values, retaining unknown pace, transport and party", () => {
  const changed = vi.fn(); document.addEventListener(travelProfileChangedEvent, changed, { once: true });
  configureTravelProfile(document, localStorage); edit(); input("station", "京都駅"); click('[type="submit"]');
  expect(document.body.textContent).toContain("この端末に保存しました"); expect(changed).toHaveBeenCalledOnce();
  const profile = loadUserProfile(localStorage)!;
  expect(profile.home).toEqual({ station: "京都駅" }); expect(profile.travelStyle).toEqual({});
  expect(profile.transport).toEqual({}); expect(profile.companions.usualPartySize).toBeUndefined();
});

it("round-trips all legacy tolerances and weights, children and unlimited travel unchanged", () => {
  const original = saveUserProfile(localStorage, { home: { station: "京都駅", area: "京都", carAvailable: true },
    companions: { usual: ["family"], children: [{ ageGroup: "teen" }] },
    travelStyle: { pace: .123, novelty: .42, crowdTolerance: .2, walkingTolerance: .65, transferTolerance: .3,
      earlyMorningTolerance: .1, lateNightTolerance: .2, drivingTolerance: .9, busTolerance: .53 },
    preferences: { sea: .717, history: .823 }, transport: { maxTypicalTravelMinutes: null } });
  localStorage.setItem("trips", '[{"id":"A"},{"id":"B"}]');
  configureTravelProfile(document, localStorage); edit(); click('[type="submit"]');
  expect(loadUserProfile(localStorage)).toEqual({ ...original, updatedAt: expect.any(String) });
  expect(localStorage.getItem("trips")).toBe('[{"id":"A"},{"id":"B"}]');
});

it("cancel/Escape retains the original and requests explicit discard for dirty edits", () => {
  configureTravelProfile(document, localStorage); edit(); input("station", "未保存の駅");
  click("[data-close]"); expect(document.querySelector<HTMLDialogElement>("dialog")!.open).toBe(true);
  expect(document.body.textContent).toContain("まだ保存されていません"); click("[data-discard]");
  expect(loadUserProfile(localStorage)).toBeUndefined();
  edit(); expect(document.querySelector<HTMLInputElement>('[name="station"]')!.value).toBe("");
});

it("does not display success or lose input when quota fails", () => {
  const failingStorage = { getItem: (key: string) => localStorage.getItem(key), removeItem: (key: string) => localStorage.removeItem(key),
    setItem: () => { throw new Error("quota"); } } as unknown as Storage;
  configureTravelProfile(document, failingStorage); edit(); input("station", "京都駅");
  click('[type="submit"]'); expect(document.body.textContent).toContain("保存できませんでした");
  expect(document.querySelector<HTMLInputElement>('[name="station"]')!.value).toBe("京都駅"); expect(loadUserProfile(localStorage)).toBeUndefined();
});

it("retains corrupt data until explicit deletion, never labels it empty or saved", () => {
  localStorage.setItem(travelProfileStorageKey, "broken"); configureTravelProfile(document, localStorage); edit();
  input("station", "京都駅"); click('[type="submit"]'); expect(localStorage.getItem(travelProfileStorageKey)).toBe("broken");
  click("[data-delete]"); expect(localStorage.getItem(travelProfileStorageKey)).toBe("broken");
  click("[data-delete]"); expect(localStorage.getItem(travelProfileStorageKey)).toBeNull();
});

it("stores free text literally without creating HTML or executable commands", () => {
  configureTravelProfile(document, localStorage); edit(); input("food", '<img src=x onerror="alert(1)">');
  click('[type="submit"]'); click("[data-edit]"); expect(document.querySelector("img")).toBeNull();
  expect(document.querySelector<HTMLTextAreaElement>('[name="food"]')!.value).toContain("<img");
});
