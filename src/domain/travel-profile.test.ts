import { describe, expect, it } from "vitest";
import { deleteUserProfile, loadUserProfile, saveUserProfile, travelProfileStorageKey, travelStyleSummary, type TravelCompanion } from "./travel-profile";

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
}

const draft = {
  home: { station: "京都駅", carAvailable: false },
  companions: { usual: ["children"] as TravelCompanion[], children: [{ ageGroup: "elementary" as const }] },
  travelStyle: { pace: 0.25, novelty: 0.5, crowdTolerance: 0.3, walkingTolerance: 0.5, transferTolerance: 0.5, earlyMorningTolerance: 0.3, lateNightTolerance: 0.5, drivingTolerance: 0.5, busTolerance: 0.5 },
  preferences: { sea: 0.3, mountain: 0.3, nature: 0.8, onsen: 0.3, food: 0.8, railway: 0.3, history: 0.3, cityWalk: 0.3, animals: 0.3, art: 0.3, themePark: 0.3, shopping: 0.3 },
  transport: { maxTypicalTravelMinutes: 180 },
};

describe("travel profile", () => {
  it("stores a durable profile separately from each trip context", () => {
    const local = storage();
    const profile = saveUserProfile(local, draft, new Date("2026-08-16T00:00:00Z"));
    expect(loadUserProfile(local)).toEqual(profile);
    expect(profile).not.toHaveProperty("destinationWish");
    expect(profile.home.station).toBe("京都駅");
  });

  it("creates a rule-based travel-style summary", () => {
    const profile = saveUserProfile(storage(), draft);
    expect(travelStyleSummary(profile)).toContain("自然や食");
    expect(travelStyleSummary(profile)).toContain("ゆっくり");
  });

  it("ignores an invalid value and deletes a saved profile", () => {
    const local = storage();
    local.setItem(travelProfileStorageKey, "not-json");
    expect(loadUserProfile(local)).toBeUndefined();
    deleteUserProfile(local);
    expect(local.getItem(travelProfileStorageKey)).toBeNull();
  });
});
