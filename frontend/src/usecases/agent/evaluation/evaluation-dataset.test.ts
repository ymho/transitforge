import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseAgentEvaluationDataset } from "./evaluation-dataset";

const fixture = () => JSON.parse(readFileSync(new URL("../../../../../tests/fixtures/agent-eval-cases.json", import.meta.url), "utf8"));

describe("multi-turn dataset v4", () => {
  it("keeps the 42 five-metric cases and A–AP, adding remainder Proposal cases AQ–AU", () => {
    const data = parseAgentEvaluationDataset(fixture());
    expect(data.cases).toHaveLength(42);
    expect(data.travelProgressScenarios).toHaveLength(47);
    expect(data.conversationQualityScenarios).toHaveLength(3);
    expect(data.conversationQualityScenarios).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "feedback-izumo-provisional-plan", expected: expect.objectContaining({ maximumAskOnlyStreak: 1 }) }),
      expect.objectContaining({ id: "feedback-izumo-one-night-no-questionnaire", expected: expect.objectContaining({
        maximumAskOnlyStreak: 0, maximumTurnsToStarterPlan: 1, minimumPlacePhotos: 1,
        requiredFinalCapabilities: ["destination_overview", "provisional_itinerary", "lodging_suggestions", "place_photo"],
        forbiddenProfilePromotions: ["origin", "favorite_interests", "activities"],
      }) }),
      expect.objectContaining({ id: "feedback-open-ended-relaxed-tomorrow", expected: expect.objectContaining({
        destination: {
          mode: "discovery", minimumCandidates: 2, maximumCandidates: 3,
          recommendationScope: "loaded-timetable-west-japan-centered",
          forbiddenMainCandidates: ["熱海", "伊東", "東京", "北海道"],
        },
        maximumTurnsToStarterPlan: 1, minimumPlacePhotos: 2,
      }) }),
    ]));
    expect(data.travelProgressScenarios?.filter((c) => c.tags.includes("smoke")).map((c) => c.id)).toEqual(["AJ-in-trip-next", "AK-in-trip-rail", "AL-in-trip-rain", "AM-in-trip-location-denied", "AI-hazard-not-impact", "AF-preparation-after-ready", "AG-booking-unknown", "AH-repeated-checklist", "AC-impossible-itinerary", "AD-reservation-conflict", "AE-unknown-facts", "AB-booked-item", "AA-focused-item", "V-weather-comparison", "U-multi-city-trip", "S-eur-accommodation", "Q-accommodation", "O-taxi", "N-unknown-child-age", "A-vague", "C-candidate", "G-consecutive", "K-food"]);
    expect(data.cases.find(({ id }) => id === "vague-destination")?.expected).toMatchObject({
      toolSequence: ["search_web", "read_web_pages", "resolve_place_candidates"],
      constraints: { requiresStarterItinerary: true, requiresPlacePhoto: true },
      status: "completed",
    });
  });
  it("accepts single-turn cases and rejects retired dataset versions", () => {
    const raw = fixture(); delete raw.travelProgressScenarios; delete raw.conversationQualityScenarios; raw.schemaVersion = "agent-eval-dataset-v4";
    expect(parseAgentEvaluationDataset(raw)).toEqual(raw);
    raw.schemaVersion = "agent-eval-dataset-v1";
    expect(() => parseAgentEvaluationDataset(raw)).toThrow();
  });
  it.each(["no-turn", "assistant-turn", "bad-date", "extra", "cross-id", "bad-destination"])("rejects invalid conversation quality scenario: %s", (invalid) => {
    const raw = fixture(), scenario = raw.conversationQualityScenarios[0];
    if (invalid === "no-turn") scenario.turns = [];
    if (invalid === "assistant-turn") scenario.turns[0].role = "assistant";
    if (invalid === "bad-date") scenario.expected.relativeDates[0].calendarDate = "tomorrow";
    if (invalid === "extra") scenario.expected.score = 1;
    if (invalid === "cross-id") scenario.id = raw.cases[0].id;
    if (invalid === "bad-destination") scenario.expected.destination.mode = "discovery";
    expect(() => parseAgentEvaluationDataset(raw)).toThrow();
  });
  it.each(["no-starter-plan", "no-photo"])("rejects invalid first-response quality threshold: %s", (invalid) => {
    const raw = fixture(), expected = raw.conversationQualityScenarios[0].expected;
    if (invalid === "no-starter-plan") expected.maximumTurnsToStarterPlan = 0;
    if (invalid === "no-photo") expected.minimumPlacePhotos = 0;
    expect(() => parseAgentEvaluationDataset(raw)).toThrow();
  });
  it.each(["duplicate", "extra", "zero", "negative", "missing", "cross-id", "empty"])("rejects %s", (invalid) => {
    const raw = fixture();
    const first = raw.travelProgressScenarios[0];
    if (invalid === "duplicate") raw.travelProgressScenarios.push(first);
    if (invalid === "extra") first.thresholds.toolName = "search_web";
    if (invalid === "zero") first.thresholds.ttfc = 0;
    if (invalid === "negative") first.thresholds.maximumOrdinaryAskOnlyStreak = -1;
    if (invalid === "missing") delete first.thresholds.selectionToDraft;
    if (invalid === "cross-id") first.id = raw.cases[0].id;
    if (invalid === "empty") raw.travelProgressScenarios = [];
    expect(() => parseAgentEvaluationDataset(raw)).toThrow();
  });
});
