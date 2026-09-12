import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseAgentEvaluationDataset } from "./evaluation-dataset";

const fixture = () => JSON.parse(readFileSync(new URL("../../../../../tests/fixtures/agent-eval-cases.json", import.meta.url), "utf8"));

describe("multi-turn dataset v2", () => {
  it("keeps the 42 six-metric cases and A–L, adding party M/N", () => {
    const data = parseAgentEvaluationDataset(fixture());
    expect(data.cases).toHaveLength(42);
    expect(data.travelProgressScenarios).toHaveLength(14);
    expect(data.travelProgressScenarios?.filter((c) => c.tags.includes("smoke")).map((c) => c.id)).toEqual(["N-unknown-child-age", "A-vague", "C-candidate", "G-consecutive", "K-food"]);
  });
  it("reads legacy v1 without dropping or inventing observations", () => {
    const raw = fixture(); delete raw.travelProgressScenarios; raw.schemaVersion = "agent-eval-dataset-v1";
    expect(parseAgentEvaluationDataset(raw)).toEqual(raw);
    raw.travelProgressScenarios = fixture().travelProgressScenarios;
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
