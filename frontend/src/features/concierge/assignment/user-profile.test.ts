import { describe, expect, it } from "vitest";
import type { UserProfile } from "@raiquora/trip/travel-profile";
import { selectConciergeForUserProfile } from "./user-profile";

function profile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    version: 2,
    home: { carAvailable: false },
    companions: { usual: ["solo"], children: [] },
    travelStyle: {
      pace: 0.5,
      novelty: 0.5,
      crowdTolerance: 0.5,
      walkingTolerance: 0.5,
      transferTolerance: 0.5,
      earlyMorningTolerance: 0.5,
      lateNightTolerance: 0.5,
      drivingTolerance: 0.5,
      busTolerance: 0.5,
    },
    preferences: {
      sea: 0.3, mountain: 0.3, nature: 0.3, onsen: 0.3,
      food: 0.3, railway: 0.3, history: 0.3, cityWalk: 0.3,
      animals: 0.3, art: 0.3, themePark: 0.3, shopping: 0.3,
    },
    transport: { maxTypicalTravelMinutes: 120 },
    updatedAt: "2026-08-16T00:00:00.000Z",
    ...overrides,
  };
}

describe("selectConciergeForUserProfile", () => {
  it("プロフィールがない場合はあかりを案内役にする", () => {
    expect(selectConciergeForUserProfile(undefined).id).toBe("akari");
  });

  it("温泉と自然を好みゆっくり旅をする利用者には小春を選ぶ", () => {
    const user = profile({
      travelStyle: { ...profile().travelStyle, pace: 0.15 },
      preferences: { ...profile().preferences, onsen: 1, nature: 1 },
    });
    expect(selectConciergeForUserProfile(user).id).toBe("koharu");
  });
});
