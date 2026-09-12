import { describe, expect, it } from "vitest";
import { AgentTraceRecorder } from "../agent-trace";
import { observeAgentTurn, type VisibleProgress, type AskOnlyException } from "../agent-turn-outcome";
import { evaluateTravelProgress, renderTravelProgressMarkdown, type TravelProgressTurn } from "./travel-progress-evaluation";

const limits = { ttfc: 2, ttfi: 2, selectionToDraft: 1, maximumOrdinaryAskOnlyStreak: 1 };
const turn = (kind?: VisibleProgress["kind"], ask = false, exception?: AskOnlyException): TravelProgressTurn => ({
  delivered: true, observation: observeAgentTurn(ask, kind ? [{ kind, refs: ["artifact"] }] : [], exception),
});

describe("Trip progress metrics (response-level, not model-call-level)", () => {
  it("counts candidate at 1, itinerary at 2, selection-to-draft at 1", () => {
    const r = evaluateTravelProgress("B", [turn("candidates", true), { ...turn("itinerary"), candidateSelected: { targetItemId: "artifact" } }], limits);
    expect(r).toMatchObject({ ttfc: 1, ttfi: 2, turnsFromCandidateSelectionToItinerary: 1, askAndProgressTurns: 1,
      planProgressRate: 1, eligibleAssistantTurns: 2, progressTurns: 2, passed: true });
  });
  it("fails selecting a candidate then asking only, even if an earlier itinerary existed", () => {
    const r = evaluateTravelProgress("C", [turn("itinerary"), { ...turn(undefined, true), candidateSelected: { targetItemId: "artifact" } }], { ...limits, ttfc: undefined });
    expect(r.ttfi).toBe(1);
    expect(r.selections).toEqual([{ beforeAssistantTurn: 2, turnsToDraft: null }]);
    expect(r.passed).toBe(false);
    expect(r.failureReasons).toContain("clarification_required");
  });
  it("reports selection threshold overrun and does not fulfill superseded selection", () => {
    const r = evaluateTravelProgress("select", [{ ...turn("candidates"), candidateSelected: { targetItemId: "artifact" } },
      { ...turn(undefined, true), candidateSelected: { targetItemId: "artifact" } }, turn("itinerary")], limits);
    expect(r.selections).toEqual([{ beforeAssistantTurn: 1, turnsToDraft: null }, { beforeAssistantTurn: 2, turnsToDraft: 2 }]);
    expect(r.failures).toHaveLength(3); // TTFI and both selections
  });
  it("does not count hidden/internal proposals, empty refs, grounded prose or state as milestones", () => {
    for (const t of [{ ...turn("itinerary"), delivered: false }, turn("grounded_decision"),
      { delivered: true, observation: observeAgentTurn(false, [{ kind: "candidates", refs: [] }]) }]) {
      const r = evaluateTravelProgress("hidden", [t], limits);
      expect(r.ttfc).toBeNull(); expect(r.ttfi).toBeNull(); expect(r.passed).toBe(false);
    }
    expect(evaluateTravelProgress("decision", [turn("grounded_decision")], limits).progressTurns).toBe(1);
  });
  it("retains public questions when the proposal is hidden, and does not fulfill selection with an unrelated item", () => {
    const r = evaluateTravelProgress("hidden-question", [{ ...turn("itinerary", true), delivered: false, candidateSelected: { targetItemId: "outbound" } },
      turn("itinerary")], limits);
    expect(r.askOnlyTurns).toBe(1);
    expect(r.ttfi).toBe(2);
    expect(r.turnsFromCandidateSelectionToItinerary).toBeNull();
    expect(r.passed).toBe(false);
  });
  it.each(["safety", "hard_constraint_unknown", "tool_input_missing"] as const)("retains raw streak and exception %s without an ordinary-loop failure", (reason) => {
    const r = evaluateTravelProgress("exception", [turn(undefined, true), turn(undefined, true, { reason, missingFact: "secret=value 35.1234,135.1234" })],
      { selectionToDraft: 1, maximumOrdinaryAskOnlyStreak: 1 });
    expect(r).toMatchObject({ maximumQuestionOnlyStreak: 2, maximumOrdinaryQuestionOnlyStreak: 1,
      askOnlyTurns: 2, eligibleAssistantTurns: 2, progressTurns: 0, passed: true });
    expect(r.exceptions).toEqual([{ turn: 2, reason }]);
    expect(JSON.stringify(r) + renderTravelProgressMarkdown([r])).not.toMatch(/secret|35\.1234|135\.1234|missingFact/);
  });
  it("fails ordinary consecutive ask_only, includes them in denominator", () => {
    const r = evaluateTravelProgress("loop", [turn(undefined, true), turn(undefined, true), turn("candidates")], limits);
    expect(r.maximumQuestionOnlyStreak).toBe(2); expect(r.planProgressRate).toBe(1 / 3);
    expect(r.failureReasons).toEqual(expect.arrayContaining(["ask_only_loop", "candidate_only", "candidate_not_selected"]));
  });
  it("does not invent zero latency/calls or silently discard failed response observations", () => {
    const r = evaluateTravelProgress("partial", [turn("candidates"), { delivered: true }], limits);
    expect(r).toMatchObject({ ttfi: null, missingObservationTurns: [2], planProgressRate: 0.5, passed: false,
      latencyMs: null, modelCalls: null, toolCalls: null, traceIncomplete: true });
    expect(evaluateTravelProgress("empty", [], limits)).toMatchObject({ ttfc: null, planProgressRate: null, passed: false });
    expect(() => evaluateTravelProgress("invalid", [], { ...limits, ttfi: -1 })).toThrow();
  });
  it("derives failures only from structured traces and never counts internal rejected outputs as turns", () => {
    const trace = new AgentTraceRecorder("fixture");
    trace.turnObserved(observeAgentTurn(true, []), false);
    trace.toolCalled("tool", "propose_candidate_selection", { token: "sensitive" });
    trace.toolCompleted("tool", "propose_candidate_selection", { ok: false, error: { code: "precondition_failed", message: "rejected", retryable: false } }, 2);
    trace.taskCompleted("failed", 123, "runtime_limit_reached");
    const r = evaluateTravelProgress("trace", [{ ...turn(), trace: trace.snapshot(), modelCalls: 4 }], limits);
    expect(r).toMatchObject({ assistantTurns: 1, askOnlyTurns: 0, latencyMs: 123, modelCalls: 4, toolCalls: 1 });
    expect(r.failureReasons).toEqual(expect.arrayContaining(["runtime_limit", "proposal_rejected", "tool_failure", "no_visible_progress"]));
    expect(JSON.stringify(r)).not.toContain("sensitive");
    const truncated = { ...trace.snapshot(), droppedEventCount: 1 };
    expect(evaluateTravelProgress("truncated", [{ ...turn(), trace: truncated }], limits).toolCalls).toBeNull();
  });
  it("first milestone remains one-based for every short structured sequence", () => {
    const kinds = [undefined, "candidates", "itinerary"] as const;
    for (const a of kinds) for (const b of kinds) for (const c of kinds) {
      const sequence = [a, b, c];
      const r = evaluateTravelProgress("invariant", sequence.map((kind) => turn(kind)), limits);
      for (const [metric, kind] of [["ttfc", "candidates"], ["ttfi", "itinerary"]] as const) {
        const i = sequence.indexOf(kind);
        expect(r[metric]).toBe(i === -1 ? null : i + 1);
      }
    }
  });
  it("formats machine and human metrics, distinguishes not reached from not applicable", () => {
    const r = evaluateTravelProgress("E", [turn()], { selectionToDraft: 1, maximumOrdinaryAskOnlyStreak: 1 }, "live");
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    const markdown = renderTravelProgressMarkdown([r]);
    expect(markdown).toContain("TTFC: 未到達（閾値対象外）");
    expect(markdown).toContain("選択イベントなし"); expect(markdown).toContain("Model calls: 未計測");
  });
});
