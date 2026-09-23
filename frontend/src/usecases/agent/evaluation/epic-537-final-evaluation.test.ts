import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseEpic537FinalExpected, parseEpic537FinalInputs, parseEpic537FinalManifest,
  parseEpic537FinalObservations, runEpic537FinalEvaluation,
} from "./epic-537-final-evaluation";

const fixtureRoot = resolve(import.meta.dirname, "../../../../../tests/fixtures/epic-537-final-eval");
const read = (name: string): unknown => JSON.parse(readFileSync(resolve(fixtureRoot, name), "utf8"));

describe("Epic #537 final evaluation contract", () => {
  it("keeps inputs, expectations, observations and run manifest physically separate", () => {
    const inputs = parseEpic537FinalInputs(read("inputs.json"));
    const expected = parseEpic537FinalExpected(read("expected.json"));
    const observations = parseEpic537FinalObservations(read("observations.json"));
    const manifest = parseEpic537FinalManifest(read("manifest.json"));
    expect(JSON.stringify(inputs)).not.toMatch(/requiredInvariantIds|minimumMetrics|passed/);
    expect(expected.cases).toHaveLength(inputs.cases.length);
    const report = runEpic537FinalEvaluation(inputs, expected, observations, manifest);
    expect(report.cases.filter(({ passed }) => passed)).toHaveLength(0);
    expect(report.cases.filter(({ passed }) => passed === null)).toHaveLength(4);
    expect(report.layers.A_pure_domain.notMeasured).toBe(1);
    expect(report.layers.B_production_composition_synthetic.notMeasured).toBe(1);
    expect(report.layers.C_live_model_synthetic_provider.notMeasured).toBe(1);
    expect(report.layers.D_live_provider_browser_server.notMeasured).toBe(1);
    expect(report.allComparisonCellsMeasured).toBe(false);
  });

  it("never turns unmeasured cells into a numeric zero", () => {
    const manifest = read("manifest.json") as { comparison: Array<Record<string, unknown>> };
    manifest.comparison[0]!.metrics = { semanticGrounding: 0 };
    expect(() => parseEpic537FinalManifest(manifest)).toThrow(/null, never zero/);
    const observations = read("observations.json") as { observations: Array<Record<string, unknown>> };
    observations.observations[2]!.metrics = { semanticGrounding: 0 };
    expect(() => parseEpic537FinalObservations(observations)).toThrow(/null, never zero/);
  });

  it("requires at least three repetitions for live observations and every measured 2x2 cell", () => {
    const observations = read("observations.json") as { observations: Array<Record<string, unknown>> };
    Object.assign(observations.observations[2]!, { status: "measured", repetitions: 1, reason: undefined, metrics: { semanticGrounding: 1 } });
    expect(() => parseEpic537FinalObservations(observations)).toThrow(/three repetitions/);
    const manifest = read("manifest.json") as { comparison: Array<Record<string, unknown>> };
    Object.assign(manifest.comparison[2]!, { status: "measured", repetitions: 1, reason: undefined, metrics: { semanticGrounding: 1 }, latencyP95Ms: 10, estimatedCostUsd: 0.01 });
    expect(() => parseEpic537FinalManifest(manifest)).toThrow(/three repetitions/);
  });

  it("does not let a successful A/B observation substitute for a missing C/D case", () => {
    const inputs = parseEpic537FinalInputs(read("inputs.json"));
    const expected = parseEpic537FinalExpected(read("expected.json"));
    const observations = parseEpic537FinalObservations(read("observations.json"));
    observations.observations = observations.observations.filter(({ layer }) => !layer.startsWith("D_"));
    expect(() => runEpic537FinalEvaluation(inputs, expected, observations, parseEpic537FinalManifest(read("manifest.json")))).toThrow(/Missing or mismatched/);
  });
});
