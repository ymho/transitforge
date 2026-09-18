import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseAgentEvaluationDataset } from "./evaluation-dataset";

const fixture = () => JSON.parse(readFileSync(new URL("../../../../../tests/fixtures/agent-eval-cases.json", import.meta.url), "utf8"));

describe("multi-turn dataset v3", () => {
  it("keeps the 42 five-metric cases and A–AP, adding remainder Proposal cases AQ–AU", () => {
    const data = parseAgentEvaluationDataset(fixture());
    expect(data.cases).toHaveLength(42);
    expect(data.travelProgressScenarios).toHaveLength(47);
    expect(data.travelProgressScenarios?.filter((c) => c.tags.includes("smoke")).map((c) => c.id)).toEqual(["AJ-in-trip-next", "AK-in-trip-rail", "AL-in-trip-rain", "AM-in-trip-location-denied", "AI-hazard-not-impact", "AF-preparation-after-ready", "AG-booking-unknown", "AH-repeated-checklist", "AC-impossible-itinerary", "AD-reservation-conflict", "AE-unknown-facts", "AB-booked-item", "AA-focused-item", "V-weather-comparison", "U-multi-city-trip", "S-eur-accommodation", "Q-accommodation", "O-taxi", "N-unknown-child-age", "A-vague", "C-candidate", "G-consecutive", "K-food"]);
  });
  it("accepts single-turn cases and rejects retired dataset versions", () => {
    const raw = fixture(); delete raw.travelProgressScenarios; raw.schemaVersion = "agent-eval-dataset-v3";
    expect(parseAgentEvaluationDataset(raw)).toEqual(raw);
    raw.schemaVersion = "agent-eval-dataset-v1";
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
