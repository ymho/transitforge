import { describe, expect, it } from "vitest";
import { deleteUserProfile, loadUserProfile, saveUserProfile, travelProfileStorageKey } from "./travel-profile";

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
}

describe("travel profile", () => {
  it("stores a durable preference separately from each trip context", () => {
    const local = storage();
    const profile = saveUserProfile(local, { homeStation: "京都", companions: ["children"], childAgeBands: ["小学生"], interests: ["自然"], pace: "relaxed", maximumTravelMinutes: 180, avoidances: ["混雑"], carAvailable: false }, new Date("2026-08-16T00:00:00Z"));
    expect(loadUserProfile(local)).toEqual(profile);
    expect(profile).not.toHaveProperty("destinationWish");
  });

  it("ignores an invalid value and deletes a saved profile", () => {
    const local = storage();
    local.setItem(travelProfileStorageKey, "not-json");
    expect(loadUserProfile(local)).toBeUndefined();
    deleteUserProfile(local);
    expect(local.getItem(travelProfileStorageKey)).toBeNull();
  });
});
