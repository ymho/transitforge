import { describe, expect, it } from "vitest";

import type { ViewerAgentJourneyPlan } from "./viewer-agent-response";
import {
  applyJourneyLegAlternative,
  intermediateStopsResponse,
  journeyChatFollowUpIntent,
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
  it("recognizes a request to avoid the Shinkansen in the previous route", () => {
    expect(journeyChatFollowUpIntent(
      "新幹線を使いたくない",
      plan,
    )).toEqual({
      type: "exclude-trains",
      exclusions: {
        serviceTypes: ["新幹線"],
        trainNames: [],
        trainNumbers: [],
        serviceUids: [],
      },
    });
  });

  it("distinguishes a service type from a named limited express", () => {
    expect(journeyChatFollowUpIntent("特急を使いたくない", plan)).toEqual({
      type: "exclude-trains",
      exclusions: {
        serviceTypes: ["特急"],
        trainNames: [],
        trainNumbers: [],
        serviceUids: [],
      },
    });
    expect(journeyChatFollowUpIntent("特急やくもを避けて", plan)).toEqual({
      type: "exclude-trains",
      exclusions: {
        serviceTypes: [],
        trainNames: ["やくも"],
        trainNumbers: [],
        serviceUids: [],
      },
    });
  });

  it("recognizes a train number and a contextual leg", () => {
    expect(journeyChatFollowUpIntent("1005Mを除外", plan)).toMatchObject({
      type: "exclude-trains",
      exclusions: { trainNumbers: ["1005M"] },
    });
    expect(journeyChatFollowUpIntent("2本目の列車を避けて", plan)).toMatchObject({
      type: "exclude-trains",
      exclusions: { serviceUids: ["second"] },
    });
  });

  it("finds the referenced leg for an intermediate-stop question", () => {
    expect(journeyChatFollowUpIntent(
      "新大阪から岡山までに停車する駅は？",
      plan,
    )).toEqual({ type: "intermediate-stops", journeyIndex: 0, legIndex: 0 });
    expect(intermediateStopsResponse(plan, 0, 0)).toContain("08:13 新神戸駅");
  });

  it("recognizes a request for a later alternative", () => {
    expect(journeyChatFollowUpIntent(
      "新大阪から岡山まで違う列車にしたい 遅く家を出たい",
      plan,
    )).toEqual({
      type: "alternative",
      journeyIndex: 0,
      legIndex: 0,
      endLegIndex: 0,
      preferLaterDeparture: true,
      requiredServiceTypes: [],
    });
  });

  it("recognizes a service preference for a multi-leg segment", () => {
    const multiLegPlan: ViewerAgentJourneyPlan = {
      ...plan,
      originStation: "京都",
      journeys: [{
        ...plan.journeys[0],
        legs: [{
          ...plan.journeys[0].legs[0],
          originStation: "京都",
          destinationStation: "新大阪",
        }, {
          ...plan.journeys[0].legs[0],
          serviceUid: "second-first",
          trainNumber: "3500M",
          serviceType: "新快速",
          trainName: "",
          originStation: "新大阪",
          destinationStation: "岡山",
        }, plan.journeys[0].legs[1]],
      }],
    };
    expect(journeyChatFollowUpIntent(
      "京都から岡山は新幹線が良い",
      multiLegPlan,
    )).toEqual({
      type: "alternative",
      journeyIndex: 0,
      legIndex: 0,
      endLegIndex: 1,
      preferLaterDeparture: false,
      requiredServiceTypes: ["新幹線"],
    });
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
    expect(journeyChatFollowUpIntent("1番に変更して", plan, pending)).toEqual({
      type: "confirm-alternative",
      alternativeIndex: 0,
    });
    expect(journeyChatFollowUpIntent("1", plan, pending)).toEqual({
      type: "confirm-alternative",
      alternativeIndex: 0,
    });
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
