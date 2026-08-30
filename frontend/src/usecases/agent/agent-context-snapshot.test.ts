import { describe, expect, it } from "vitest";

import type { UserProfile } from "@raiquora/trip/travel-profile";
import type { TripPlan } from "@raiquora/trip/trip-plan";
import { createAgentContextSnapshot } from "./agent-context-snapshot";

const profile: UserProfile = {
  version: 2,
  home: { station: "向日町駅", area: "京都府", carAvailable: false },
  companions: { usual: ["partner", "children"], children: [{ ageGroup: "elementary" }] },
  travelStyle: {
    pace: 0.25,
    novelty: 0.8,
    crowdTolerance: 0.2,
    walkingTolerance: 0.5,
    transferTolerance: 0.3,
    earlyMorningTolerance: 0.2,
    lateNightTolerance: 0.7,
    drivingTolerance: 0.1,
    busTolerance: 0.6,
  },
  preferences: {
    sea: 0.8, mountain: 0.3, nature: 0.9, onsen: 0.8, food: 0.7,
    railway: 0.4, history: 0.9, cityWalk: 0.3, animals: 0.3, art: 0.3,
    themePark: 0.3, shopping: 0.3,
  },
  transport: { maxTypicalTravelMinutes: 180 },
  updatedAt: "2026-08-20T00:00:00.000Z",
};

const trip: TripPlan = {
  version: 1,
  id: "private-trip-id",
  title: "出雲の神話と海を巡る旅",
  destination: "出雲市",
  conditions: { adults: 2, children: 1, considerations: ["混雑を避ける"] },
  updatedAt: "2026-08-27T00:00:00.000Z",
  items: [{
    id: "private-item-id",
    type: "movement",
    mode: "rail",
    route: {
      originStation: "向日町",
      destinationStation: "出雲市",
      departureDate: "2026-09-05",
      journeys: [{ departureTimeMinutes: 480, arrivalTimeMinutes: 720, transferCount: 2, legs: [] }],
    },
  }],
};

describe("agent context snapshot", () => {
  it("projects only a bounded operational subset of profile and trip", () => {
    const snapshot = createAgentContextSnapshot(profile, trip);
    const encoded = JSON.stringify(snapshot);
    expect(snapshot.profile?.home?.station).toBe("向日町駅");
    expect(snapshot.profile?.favoriteInterests).toEqual(["自然", "歴史", "海", "温泉", "食"]);
    expect(snapshot.trip?.schedule[0]).toEqual(expect.objectContaining({
      summary: "向日町→出雲市（鉄道 乗換2回）",
      departureTimeMinutes: 480,
      arrivalTimeMinutes: 720,
    }));
    expect(encoded).not.toContain("private-trip-id");
    expect(encoded).not.toContain("private-item-id");
    expect(encoded).not.toContain("updatedAt");
    expect(encoded).not.toContain("coordinate");
    expect(encoded).not.toContain("bookingUrl");
  });
});
