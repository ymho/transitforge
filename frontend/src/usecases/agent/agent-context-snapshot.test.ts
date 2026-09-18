import { describe, expect, it } from "vitest";

import type { UserProfile } from "@raiquora/trip/travel-profile";
import type { TripPlan } from "@raiquora/trip/trip-plan";
import { createAgentContextSnapshot } from "./agent-context-snapshot";
import { createTrip } from "@raiquora/trip/trip";
import { selectRailJourney, projectRailSchedule } from "@raiquora/trip/selected-rail-journey";
import type { ItinerarySchedule } from "@raiquora/trip/itinerary-schedule";
import { buildAgentDecisionContext, agentDecisionContextText } from "./agent-decision-context";
import { railSelectionFixture } from "../../../../modules/trip/domain/selected-rail-journey.fixture";
import { partyRequest } from "../../../../modules/trip/domain/trip-party.fixture";

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
  it("preserves unset preferences and projects only non-authoritative hints, not raw notes", () => {
    const partial: UserProfile = { version: 2, updatedAt: "2026-09-18T00:00:00Z", home: {},
      companions: { usual: [], children: [], usualPartySize: 3 }, travelStyle: {}, preferences: {},
      transport: { preferredMode: "rail" }, notes: { food: "private free text" } };
    const snapshot = createAgentContextSnapshot(partial);
    expect(snapshot.profile).toMatchObject({ usualPartySizeHint: 3, preferredTransportHint: "rail" });
    expect(snapshot.profile?.pace).toBeUndefined(); expect(snapshot.profile?.home).toBeUndefined();
    expect(snapshot.trip).toBeUndefined(); expect(JSON.stringify(snapshot)).not.toContain("private free text");
  });
  it("keeps persisted party, linked assumptions and usual profile separate even after compression", () => {
    const request = partyRequest();
    const current = createTrip("11111111-1111-4111-8111-111111111111", "旅", "2026-09-12T08:00:00Z", [], request);
    const snapshot = createAgentContextSnapshot(profile, current);
    expect(snapshot.trip?.request?.party).toEqual(request.party);
    expect(snapshot.profile?.companions).toEqual(["パートナー", "子ども"]);
    expect(snapshot.profile?.childAgeGroups).toEqual(["小学生"]);
    expect(snapshot.trip).not.toHaveProperty("adults");
    const context = buildAgentDecisionContext({ executionId: "party-context", feature: "concierge", userRequest: "この条件で",
      context: { currentTrip: { ...snapshot.trip!, schedule: Array.from({ length: 80 }, () => ({ description: "詳細".repeat(200) })) }, travelProfile: snapshot.profile } }, []);
    const parsed = JSON.parse(agentDecisionContextText(context).match(/<agent_context>([\s\S]*)<\/agent_context>/u)![1]!);
    expect(parsed.persistedTripRequest.party).toEqual(request.party);
    expect(parsed.unconfirmedAssumptions).toEqual(request.assumptions);
    expect(parsed.travelProfile.childAgeGroups).toEqual(["小学生"]);
    expect(parsed.persistedTripRequest.party.children).toEqual([{}]);
    expect(createAgentContextSnapshot(profile, createTrip(current.id, "新しい旅", current.createdAt)).trip?.request?.party).toBeUndefined();
  });
  it("projects V2 adopted schedule without search results or realtime fields", () => {
    const { candidate, inputs, selectedAt } = railSelectionFixture();
    const journey = selectRailJourney(candidate, inputs, selectedAt);
    const current = createTrip("11111111-1111-4111-8111-111111111111", "選択済み旅", selectedAt, [{
      id: "selected", type: "transport", title: "移動", schedule: projectRailSchedule(journey), detail: { status: "selected", mode: "rail", journey },
    }]);
    const snapshot = createAgentContextSnapshot(undefined, current);
    expect(snapshot.trip?.schedule[0]).toMatchObject({ selectionStatus: "selected", date: "2026-09-13" });
    expect(snapshot.trip?.schedule[0]?.summary).toContain("2026-09-13T09:00:00.000+09:00");
    expect(snapshot.travelCandidates).toBeUndefined();
    expect(snapshot.realtimeFacts).toBeUndefined();
    expect(JSON.stringify(snapshot)).not.toContain("delay");
  });
  it("preserves all schedule variants through the bounded model context without shared references", () => {
    const start = { at: "2026-09-22T14:00:00+02:00", timeZone: "Europe/Vienna" };
    const end = { at: "2026-09-22T18:00:00+02:00", timeZone: "Europe/Vienna" };
    const schedules: ItinerarySchedule[] = [
      { type: "fixed", startAt: start },
      { type: "window", earliestStart: start, latestEnd: end, durationMinutes: 90 },
      { type: "day", date: "2026-09-22" }, { type: "unscheduled" },
    ];
    const current = createTrip("11111111-1111-4111-8111-111111111111", "旅", "2026-09-12T08:00:00Z",
      schedules.map((schedule, index) => ({ id: `item-${index}`, title: "未採用移動", type: "transport", schedule, detail: { status: "unresolved" } })));
    const snapshot = createAgentContextSnapshot(undefined, current);
    const decision = buildAgentDecisionContext({ executionId: "schedule", feature: "concierge", userRequest: "旅程を比較",
      context: { currentTrip: { ...snapshot.trip! } } }, []);
    const parsed = JSON.parse(agentDecisionContextText(decision).match(/<agent_context>([\s\S]*)<\/agent_context>/u)![1]!);
    expect(parsed.currentTrip.schedule.map((item: { schedule: ItinerarySchedule }) => item.schedule)).toEqual(schedules);
    expect(snapshot.trip!.schedule[0]!.schedule).not.toBe(current.items[0]!.schedule);
    expect(parsed.currentTrip.schedule[2].schedule).not.toHaveProperty("timeZone");
  });
  it("keeps a provisional starting point distinct from the profile", () => {
    const snapshot = createAgentContextSnapshot(profile, {
      ...trip, items: [{ id: "example", type: "movement", mode: "rail", route: {
        originStation: "神戸", originIsProvisional: true, destinationStation: "大阪", journeys: [],
      } }],
    });
    expect(snapshot.profile?.home?.station).toBe("向日町駅");
    expect(snapshot.trip?.schedule[0]?.originIsProvisional).toBe(true);
  });
  it("projects only a bounded operational subset of profile and trip", () => {
    const snapshot = createAgentContextSnapshot(profile, trip);
    const encoded = JSON.stringify(snapshot);
    expect(snapshot.profile?.home?.station).toBe("向日町駅");
    expect(snapshot.profile?.favoriteInterests).toEqual(["自然", "歴史", "海", "温泉", "食"]);
    expect(snapshot.trip?.schedule[0]).toEqual(expect.objectContaining({
      summary: "向日町→出雲市（鉄道・経路未採用）",
      selectionStatus: "unresolved",
    }));
    expect(encoded).not.toContain("private-trip-id");
    expect(encoded).not.toContain("private-item-id");
    expect(encoded).not.toContain("updatedAt");
    expect(encoded).not.toContain("coordinate");
    expect(encoded).not.toContain("bookingUrl");
    expect(snapshot.trip?.schedule[0]?.departureTimeMinutes).toBeUndefined();
    expect(snapshot.travelCandidates?.[0]).toMatchObject({ kind: "rail", selectionStatus: "not-adopted" });
    expect(snapshot.realtimeFacts?.[0]).toMatchObject({ kind: "search-time-estimate", freshness: "unknown", departureTimeMinutes: 480 });
  });
});
