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
      preferLaterDeparture: true,
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
    const changed = applyJourneyLegAlternative(pending, 0);
    expect(changed.journeys[0].legs[0].trainNumber).toBe("101A");
    expect(changed.journeys[0].departureTimeMinutes).toBe(495);
    expect(plan.journeys[0].legs[0].trainNumber).toBe("99A");
  });
});
