import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  parseAgentEvaluationDataset,
  parseAgentEvaluationObservations,
} from "./evaluation-dataset";
import { renderAgentEvaluationRunMarkdown } from "./evaluation-report";
import { runAgentEvaluationProfile, selectAgentEvaluationCase } from "./evaluation-run";

const fixtures = fileURLToPath(new URL("../../../../../tests/fixtures/", import.meta.url));

describe("Agent Evaluation profiles", () => {
  it("runs the tagged Smoke subset independently from the Full dataset", () => {
    const dataset = parseAgentEvaluationDataset(readJson("agent-eval-cases.json"));
    const observations = parseAgentEvaluationObservations(
      readJson("agent-eval-observations.json"),
    );

    const smoke = runAgentEvaluationProfile(dataset, observations, "smoke");
    const full = runAgentEvaluationProfile(dataset, observations, "full");
    expect(smoke.caseCount).toBe(12);
    expect(smoke.selectedTag).toBe("smoke");
    expect(smoke.passed).toBe(true);
    expect(full.caseCount).toBe(39);
    expect(full.selectedTag).toBeUndefined();
    expect(full.passed).toBe(true);
  });

  it("selects one failed case for deterministic reruns", () => {
    const dataset = parseAgentEvaluationDataset(readJson("agent-eval-cases.json"));
    const observations = parseAgentEvaluationObservations(
      readJson("agent-eval-observations.json"),
    );

    const selected = selectAgentEvaluationCase(dataset, observations, "cancelled-service");
    expect(selected.dataset.cases.map(({ id }) => id)).toEqual(["cancelled-service"]);
    expect(selected.observations.observations.map(({ caseId }) => caseId))
      .toEqual(["cancelled-service"]);
    expect(runAgentEvaluationProfile(
      selected.dataset,
      selected.observations,
      "full",
    ).caseCount).toBe(1);
    expect(() => selectAgentEvaluationCase(dataset, observations, "missing"))
      .toThrow("Agent Eval caseが見つかりません: missing");
  });

  it("prints the failed metric and threshold in both report formats", () => {
    const dataset = parseAgentEvaluationDataset(readJson("agent-eval-cases.json"));
    const observations = parseAgentEvaluationObservations(
      readJson("agent-eval-observations.json"),
    );
    observations.observations[0] = {
      ...observations.observations[0],
      toolSequence: ["search_trains"],
    };

    const report = runAgentEvaluationProfile(dataset, observations, "smoke");
    expect(report.passed).toBe(false);
    expect(report.thresholds.toolSelectionAccuracy).toEqual({
      operator: "minimum",
      value: 1,
    });
    expect(report.thresholdFailures[0]).toContain("toolSelectionAccuracy");
    const markdown = renderAgentEvaluationRunMarkdown(report);
    expect(markdown).toContain("toolSelectionAccuracy");
    expect(markdown).toContain("minimum 100.0%");
    expect(markdown).toContain("FAIL");
  });
});

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(`${fixtures}${name}`, "utf8"));
}
