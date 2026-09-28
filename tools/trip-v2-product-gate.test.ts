import { describe, expect, it } from "vitest";
import { evaluateTripV2Product, tripV2Scenarios, tripV2Stages, type TripV2Observation } from "./trip-v2-product-gate.js";

const sha = "a".repeat(40);
const allPassed = (): TripV2Observation[] => tripV2Scenarios.flatMap(scenario => tripV2Stages.map(stage =>
  ({ scenario, stage, status: "passed" as const, commit: sha,
    runUrl: "https://github.com/ymho/transitforge/actions/runs/123", metrics: { durationMs: 130, modelCalls: 2, toolCalls: 1 } })));

describe("Trip product evidence gate", () => {
  it("does not equate a passing SDK fixture with real Provider, browser or deployment evidence", () => {
    const report = evaluateTripV2Product(allPassed().filter(x => x.stage === "state" || x.stage === "bedrock-fixed-provider"));
    expect(report.complete).toBe(false);
    expect(report.missing).toHaveLength(tripV2Scenarios.length * 4);
    expect(report.missing).toContainEqual({ scenario: "partial-failures", stage: "real-provider" });
  });
  it("keeps owner crossing and unapproved edits fatal even when every other observation passed", () => {
    const observations = allPassed();
    observations[0]!.violations = ["owner_boundary", "unapproved_mutation"];
    const report = evaluateTripV2Product(observations);
    expect(report.complete).toBe(false);
    expect(report.failed[0]?.reasons).toEqual(["critical:owner_boundary", "critical:unapproved_mutation"]);
    expect(report.missing).toHaveLength(0);
  });
  it("does not erase failures or missing runs and rejects duplicate or untraceable observations", () => {
    const observations = allPassed();
    observations[0]!.status = "failed";
    observations[1]!.status = "not_run";
    const report = evaluateTripV2Product(observations);
    expect(report.failed).toHaveLength(1);
    expect(report.missing).toHaveLength(1);
    expect(() => evaluateTripV2Product([observations[0]!, observations[0]!])).toThrow(/duplicate/);
    expect(() => evaluateTripV2Product([{ ...observations[0]!, commit: "unknown" }])).toThrow(/commit/);
    expect(() => evaluateTripV2Product([{ ...observations[0]!, status: "passed", runUrl: undefined }])).toThrow(/run URL/);
    expect(() => evaluateTripV2Product([{ ...observations[0]!, metrics: { toolCalls: -1 } }])).toThrow(/metric/);
    expect(() => evaluateTripV2Product([{ ...observations[0]!, status: "unknown" as "passed" }])).toThrow(/status/);
    expect(() => evaluateTripV2Product([{ ...observations[0]!, reasons: ["raw user request"] }])).toThrow(/diagnostic code/);
  });
  it("passes only when every required scenario and layer has an observed pass", () => {
    expect(evaluateTripV2Product(allPassed()).complete).toBe(true);
  });
});
