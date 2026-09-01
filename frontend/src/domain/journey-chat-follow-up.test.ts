import { describe, expect, it } from "vitest";

import type { ViewerAgentJourneyPlan } from "./viewer-agent-response";
import {
  applyJourneyLegAlternative,
  intermediateStopsResponse,
  type PendingJourneyLegChange,
} from "./journey-chat-follow-up";

const plan: ViewerAgentJourneyPlan = {
  originStation: "新大阪",
  destinationStation: "出雲市",
  journeys: [{
    departureTimeMinutes: 480,
    arrivalTimeMinutes: 660,
    transferCount: 1,
    legs: [
      {
        serviceUid: "first",
        trainNumber: "99A",
        serviceType: "新幹線",
        trainName: "のぞみ99号",
        originStation: "新大阪",
        destinationStation: "岡山",
        departureTimeMinutes: 480,
        arrivalTimeMinutes: 540,
        stops: [
          { stationName: "新大阪", departureTimeMinutes: 480 },
          { stationName: "新神戸", departureTimeMinutes: 493 },
          { stationName: "岡山", arrivalTimeMinutes: 540 },
        ],
      },
      {
        serviceUid: "second",
        trainNumber: "1005M",
        serviceType: "特急",
        trainName: "やくも5号",
        originStation: "岡山",
        destinationStation: "出雲市",
        departureTimeMinutes: 553,
        arrivalTimeMinutes: 660,
      },
    ],
  }],
};

describe("journey chat follow-up", () => {
  it("formats intermediate stops from a verified journey leg", () => {
    expect(intermediateStopsResponse(plan, 0, 0)).toContain("08:13 新神戸駅");
  });

  it("applies an alternative only after confirmation", () => {
    const alternative = {
      ...plan.journeys[0].legs[0],
      serviceUid: "later",
      trainNumber: "101A",
      departureTimeMinutes: 495,
      arrivalTimeMinutes: 550,
    };
    const pending: PendingJourneyLegChange = {
      plan,
      journeyIndex: 0,
      legIndex: 0,
      alternatives: [alternative],
    };
    const changed = applyJourneyLegAlternative(pending, 0);
    expect(changed.journeys[0].legs[0].trainNumber).toBe("101A");
    expect(changed.journeys[0].departureTimeMinutes).toBe(495);
    expect(plan.journeys[0].legs[0].trainNumber).toBe("99A");
  });

  it("replaces every leg in the selected segment while preserving the rest", () => {
    const extendedPlan: ViewerAgentJourneyPlan = {
      ...plan,
      journeys: [{
        ...plan.journeys[0],
        legs: [
          plan.journeys[0].legs[0],
          { ...plan.journeys[0].legs[0], serviceUid: "middle", originStation: "岡山", destinationStation: "倉敷" },
          { ...plan.journeys[0].legs[1], originStation: "倉敷" },
        ],
      }],
    };
    const pending: PendingJourneyLegChange = {
      plan: extendedPlan,
      journeyIndex: 0,
      legIndex: 0,
      endLegIndex: 1,
      alternatives: [{
        ...plan.journeys[0].legs[0],
        serviceUid: "replacement",
        originStation: "新大阪",
        destinationStation: "倉敷",
      }],
    };
    const changed = applyJourneyLegAlternative(pending, 0);
    expect(changed.journeys[0].legs.map((leg) => leg.serviceUid)).toEqual([
      "replacement",
      "second",
    ]);
    expect(changed.journeys[0].transferCount).toBe(1);
  });
});
