import { describe, expect, it } from "vitest";

import {
  defaultJourneySearchPreferences,
  journeySearchPreferencesFromPrompt,
} from "./journey-search-preferences";

describe("journey search preferences", () => {
  it("uses the saved defaults when the prompt has no override", () => {
    expect(
      journeySearchPreferencesFromPrompt(
        "京都に行きたい",
        defaultJourneySearchPreferences,
      ),
    ).toEqual({
      transferPace: "standard",
      rankingPreference: "balanced",
      maxTransfers: 3,
    });
  });

  it("overrides preferences for only the current prompt", () => {
    expect(
      journeySearchPreferencesFromPrompt(
        "ゆっくり乗り換えて、なるべく遅く出たい",
        defaultJourneySearchPreferences,
      ),
    ).toEqual({
      transferPace: "relaxed",
      rankingPreference: "latest-departure",
      maxTransfers: 3,
    });
    expect(
      journeySearchPreferencesFromPrompt(
        "急いで最速で着きたい",
        defaultJourneySearchPreferences,
      ),
    ).toEqual({
      transferPace: "hurried",
      rankingPreference: "earliest-arrival",
      maxTransfers: 3,
    });
  });

  it("limits transfers when the prompt asks for a journey shape", () => {
    expect(
      journeySearchPreferencesFromPrompt(
        "乗換なしで行きたい",
        defaultJourneySearchPreferences,
      ).maxTransfers,
    ).toBe(0);
    expect(
      journeySearchPreferencesFromPrompt(
        "乗換2回まで",
        defaultJourneySearchPreferences,
      ).maxTransfers,
    ).toBe(2);
  });
});
