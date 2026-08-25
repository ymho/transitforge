import { describe, expect, it } from "vitest";

import type { Train } from "./rail/train";
import {
  journeyNavigationGuidanceFromPrompt,
  mergeJourneyNavigationGuidance,
  unsupportedJourneyExperienceFromPrompt,
} from "./journey-navigation-intent";

const trains: Train[] = [
  train("yakumo", "1005M", "特急", "やくも5号"),
  train("haruka", "1015M", "特急", "はるか15号"),
  train("rapid", "3400M", "新快速", ""),
  train("local", "100M", "普通", ""),
];

describe("journey navigation intent", () => {
  it("recognizes a named train before stations are given", () => {
    expect(journeyNavigationGuidanceFromPrompt("やくもにのりたい", trains))
      .toMatchObject({
        requiredTrainNames: ["やくも"],
        requiredServiceTypes: [],
      });
    expect(journeyNavigationGuidanceFromPrompt("はるか15号に乗りたい", trains))
      .toMatchObject({ requiredTrainNames: ["はるか15号"] });
  });

  it("distinguishes a service type from a named train", () => {
    expect(journeyNavigationGuidanceFromPrompt("特急で行きたい", trains))
      .toMatchObject({
        requiredServiceTypes: ["特急"],
        requiredTrainNames: [],
      });
    expect(journeyNavigationGuidanceFromPrompt("特急やくもに乗りたい", trains))
      .toMatchObject({
        requiredServiceTypes: [],
        requiredTrainNames: ["やくも"],
      });
  });

  it("recognizes an avoidance wish before stations are given", () => {
    expect(journeyNavigationGuidanceFromPrompt(
      "新幹線を使いたくない",
      trains,
    )).toMatchObject({
      excludedServiceTypes: ["新幹線"],
      requiredServiceTypes: [],
    });
    expect(journeyNavigationGuidanceFromPrompt(
      "やくもを避けたい",
      trains,
    )).toMatchObject({ excludedTrainNames: ["やくも"] });
    expect(journeyNavigationGuidanceFromPrompt(
      "在来線で行きたい",
      trains,
    )).toMatchObject({ excludedServiceTypes: ["新幹線"] });
  });

  it("limits a local-only journey to ordinary services", () => {
    expect(journeyNavigationGuidanceFromPrompt("鈍行でいきたい", trains))
      .toMatchObject({
        allowedServiceTypes: ["普通"],
        requiredServiceTypes: [],
      });
    expect(journeyNavigationGuidanceFromPrompt("各駅停車だけ", trains))
      .toMatchObject({ allowedServiceTypes: ["普通"] });
    expect(journeyNavigationGuidanceFromPrompt(
      "やくもではなく鈍行で行きたい",
      trains,
    )).toMatchObject({
      requiredTrainNames: [],
      allowedServiceTypes: ["普通"],
    });
  });

  it("recognizes journey shape and ranking wishes", () => {
    expect(journeyNavigationGuidanceFromPrompt(
      "乗換なしで早く着きたい",
      trains,
    )).toMatchObject({
      maxTransfers: 0,
      rankingPreference: "earliest-arrival",
    });
    expect(journeyNavigationGuidanceFromPrompt(
      "乗り換えたくない",
      trains,
    )).toMatchObject({ maxTransfers: 0 });
  });

  it("merges wishes given over multiple turns", () => {
    const named = journeyNavigationGuidanceFromPrompt(
      "やくもに乗りたい",
      trains,
    );
    const relaxed = journeyNavigationGuidanceFromPrompt(
      "乗換はゆっくりで",
      trains,
    );
    expect(mergeJourneyNavigationGuidance(named, relaxed)).toMatchObject({
      requiredTrainNames: ["やくも"],
      transferPace: "relaxed",
    });
    const localOnly = journeyNavigationGuidanceFromPrompt(
      "鈍行で行きたい",
      trains,
    );
    expect(mergeJourneyNavigationGuidance(named, localOnly)).toMatchObject({
      requiredTrainNames: [],
      allowedServiceTypes: ["普通"],
    });
    const withoutLimitedExpress = journeyNavigationGuidanceFromPrompt(
      "特急を使いたくない",
      trains,
    );
    expect(mergeJourneyNavigationGuidance(
      journeyNavigationGuidanceFromPrompt("特急で行きたい", trains),
      withoutLimitedExpress,
    )).toMatchObject({
      excludedServiceTypes: ["特急"],
      requiredServiceTypes: [],
    });
  });

  it("recognizes fare and seat wishes that are outside the search scope", () => {
    expect(unsupportedJourneyExperienceFromPrompt("できるだけ安く行きたい"))
      .toBe("fare");
    expect(unsupportedJourneyExperienceFromPrompt("指定席に座りたい"))
      .toBe("seat");
    expect(unsupportedJourneyExperienceFromPrompt("明日出雲で1泊したい"))
      .toBeUndefined();
    expect(unsupportedJourneyExperienceFromPrompt("観光もしたい"))
      .toBeUndefined();
  });
});

function train(
  serviceUid: string,
  trainNumber: string,
  serviceType: string,
  trainName: string,
): Train {
  return {
    service_uid: serviceUid,
    train_no: trainNumber,
    service_type: serviceType,
    train_name: trainName,
    origin_station: "出発",
    destination_station: "到着",
    path_id: "path",
    stops: [],
  };
}
