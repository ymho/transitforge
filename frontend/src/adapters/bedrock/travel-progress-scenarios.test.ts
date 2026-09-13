import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseAgentEvaluationDataset } from "../../usecases/agent/evaluation/evaluation-dataset";
import { modelTools, modelTool, modelAnswer } from "./ask-progress-scenarios.fixture";
import { runTravelProgressScenario } from "./travel-progress-scenarios.fixture";

const travelProgressScenarios = parseAgentEvaluationDataset(JSON.parse(readFileSync(
  new URL("../../../../tests/fixtures/agent-eval-cases.json", import.meta.url), "utf8"))).travelProgressScenarios!;

describe("Trip Progress through production runtime", () => {
  it("fails an unsupported model claim that an impossible trip is ready", async () => {
    const report = await runTravelProgressScenario(travelProgressScenarios.find((s) => s.id === "AC-impossible-itinerary")!, async () => modelAnswer("問題ありません。この旅程は準備完了です。"));
    expect(report.passed).toBe(false);
    expect(report.contractFailures).toContain("no reviewable correction proposal");
    expect(report.contractFailures).not.toContain("invalid ready accepted");
  });
  it.each(travelProgressScenarios)("measures $id", async (scenario) => {
    const { id } = scenario;
    const report = await runTravelProgressScenario(scenario);
    expect(report.failures).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.maximumOrdinaryQuestionOnlyStreak).toBeLessThan(2);
    if (id === "B-known-region" || id === "D-known-request") expect(report).toMatchObject({ ttfc: 1, ttfi: 2, turnsFromCandidateSelectionToItinerary: 1, repeatedKnownConditionQuestions: 0 });
    if (id === "G-consecutive") expect(report).toMatchObject({ assistantTurns: 2, askOnlyTurns: 1, maximumQuestionOnlyStreak: 1, ttfc: 2 });
    if (id === "I-multi-day") expect(report).toMatchObject({ ttfi: 1, toolCalls: 2 });
    if (id === "J-refinement") expect(report).toMatchObject({ ttfi: 1, turnsFromCandidateSelectionToItinerary: 1 });
    if (id === "E-past") expect(report).toMatchObject({ ttfc: null, ttfi: null, progressTurns: 0 });
  });
  it("catches a real completed candidate-selection response that asks only", async () => {
    const result = await runTravelProgressScenario(travelProgressScenarios.find((s) => s.id === "C-candidate")!, async () => modelTools(modelTool("ask_follow_up", {
      question: "利用できる交通手段に希望はありますか", expectedInput: "free-text", requestedRequirement: "mobility",
    })));
    expect(result.askOnlyTurns).toBe(1);
    expect(result.passed).toBe(false);
    expect(result.ttfi).toBeNull();
    expect(result.turnsFromCandidateSelectionToItinerary).toBeNull();
    expect(result.failureReasons).toContain("clarification_required");
  });
});
