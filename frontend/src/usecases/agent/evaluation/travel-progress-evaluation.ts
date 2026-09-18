import type { AgentTurnObservation, AskOnlyException } from "@raiquora/agent/agent-turn-outcome";
import { observeAgentTurn } from "@raiquora/agent/agent-turn-outcome";
import type { AgentTrace } from "@raiquora/agent/agent-trace";

/** Evaluation observations, not a new conversation/Trip state or a persisted user log. */
export interface TravelProgressTurn {
  observation?: AgentTurnObservation;
  /** Whether this assistant response delivered its artifacts. Hidden proposals cannot establish
   * a milestone; the public response/question still counts. Never insert Tool events as turns. */
  delivered: boolean;
  /** Explicit selection event immediately before this response, never inferred from text. */
  candidateSelected?: { targetItemId: string };
  trace?: AgentTrace;
  modelCalls?: number;
}

export interface TravelProgressThresholds {
  ttfc?: number;
  ttfi?: number;
  selectionToDraft: number;
  maximumOrdinaryAskOnlyStreak: number;
}

export interface TravelProgressScenario {
  id: string;
  name: string;
  userRequest: string;
  tags: string[];
  thresholds: TravelProgressThresholds;
}

export type TravelProgressFailureReason = "ask_only_loop" | "clarification_required" |
  "hard_constraint_unknown" | "tool_input_missing" | "tool_failure" | "candidate_only" |
  "candidate_not_selected" | "proposal_rejected" | "runtime_limit" | "no_visible_progress" | "unknown";

export interface TravelProgressReport {
  schemaVersion: "trip-progress-eval-v1";
  id: string;
  mode: "scripted" | "live";
  thresholds: TravelProgressThresholds;
  assistantTurns: number;
  ttfc: number | null;
  ttfi: number | null;
  selections: Array<{ beforeAssistantTurn: number; turnsToDraft: number | null }>;
  turnsFromCandidateSelectionToItinerary: number | null;
  maximumQuestionOnlyStreak: number;
  maximumOrdinaryQuestionOnlyStreak: number;
  askOnlyTurns: number;
  askAndProgressTurns: number;
  exceptions: Array<{ turn: number; reason: AskOnlyException["reason"] }>;
  progressTurns: number;
  eligibleAssistantTurns: number;
  planProgressRate: number | null;
  missingObservationTurns: number[];
  repeatedKnownConditionQuestions: number;
  failures: string[];
  /** Domain/fixture invariants remain hard checks even when live turn thresholds only warn. */
  contractFailures: string[];
  failureReasons: TravelProgressFailureReason[];
  passed: boolean;
  modelCalls: number | null;
  toolCalls: number | null;
  latencyMs: number | null;
  traceIncomplete: boolean;
}

/** A response is one turn. Internal model calls, rejected responses and replans are not turns.
 * The input is a finite, completed evaluation window; null is NOT zero or success.
 * Exceptions remain in raw metrics; only the separate ordinary-loop gate excludes them.
 */
export function evaluateTravelProgress(id: string, turns: readonly TravelProgressTurn[],
  thresholds: TravelProgressThresholds, mode: TravelProgressReport["mode"] = "scripted"): TravelProgressReport {
  for (const limit of Object.values(thresholds)) {
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0)) throw new Error("Invalid travel progress threshold");
  }
  const report: TravelProgressReport = {
    schemaVersion: "trip-progress-eval-v1", id, mode, thresholds, assistantTurns: turns.length,
    ttfc: null, ttfi: null, selections: [], turnsFromCandidateSelectionToItinerary: null,
    maximumQuestionOnlyStreak: 0, maximumOrdinaryQuestionOnlyStreak: 0, askOnlyTurns: 0,
    askAndProgressTurns: 0, exceptions: [], progressTurns: 0, eligibleAssistantTurns: turns.length,
    planProgressRate: null, missingObservationTurns: [], repeatedKnownConditionQuestions: 0,
    failures: [], contractFailures: [], failureReasons: [], passed: true, modelCalls: null, toolCalls: null, latencyMs: null,
    traceIncomplete: turns.some((t) => !t.trace || t.trace.droppedEventCount > 0),
  };
  const reasons = new Set<TravelProgressFailureReason>();
  let streak = 0, ordinaryStreak = 0;
  for (const [index, turn] of turns.entries()) {
    const n = index + 1;
    if (turn.candidateSelected) report.selections.push({ beforeAssistantTurn: n, turnsToDraft: null });
    const observed = turn.observation ? observeAgentTurn(
      turn.observation.outcome === "ask_only" || turn.observation.outcome === "ask_and_progress",
      turn.delivered ? turn.observation.progress : [], turn.observation.exception) : undefined;
    if (!turn.observation) report.missingObservationTurns.push(n);
    const progress = observed?.progress.filter((p) => p.refs.length > 0) ?? [];
    if (progress.length) report.progressTurns++;
    if (progress.some((p) => p.kind === "candidates") && report.ttfc === null) report.ttfc = n;
    if (progress.some((p) => p.kind === "itinerary")) {
      report.ttfi ??= n;
      // Only the latest pending selection can be fulfilled; replacing it does not retroactively
      // turn a previously abandoned selection into a successful adoption.
      const selection = report.selections.at(-1);
      const target = selection && turns[selection.beforeAssistantTurn - 1]?.candidateSelected?.targetItemId;
      if (selection && selection.turnsToDraft === null && target && progress.some((p) => p.kind === "itinerary" && p.refs.includes(target))) {
        selection.turnsToDraft = n - selection.beforeAssistantTurn + 1;
      }
    }
    const askOnly = observed?.outcome === "ask_only";
    streak = askOnly ? streak + 1 : 0;
    ordinaryStreak = askOnly && !observed?.exception ? ordinaryStreak + 1 : 0;
    report.maximumQuestionOnlyStreak = Math.max(report.maximumQuestionOnlyStreak, streak);
    report.maximumOrdinaryQuestionOnlyStreak = Math.max(report.maximumOrdinaryQuestionOnlyStreak, ordinaryStreak);
    if (askOnly) { report.askOnlyTurns++; reasons.add("clarification_required"); }
    if (observed?.outcome === "ask_and_progress") report.askAndProgressTurns++;
    if (observed?.exception) {
      report.exceptions.push({ turn: n, reason: observed.exception.reason });
      if (observed.exception.reason !== "safety") reasons.add(observed.exception.reason);
    }
    for (const event of turn.trace?.events ?? []) {
      if (event.type === "task_completed" && event.reason === "runtime_limit_reached") reasons.add("runtime_limit");
      if (event.type === "tool_completed" && event.outcome === "error") {
        reasons.add("tool_failure");
        if (["propose_itinerary_removal_or_move", "propose_candidate_selection", "propose_request_assumptions", "propose_manual_activity", "propose_activity_selection", "propose_manual_transport", "propose_transport_selection"].includes(event.toolName)) reasons.add("proposal_rejected");
      }
    }
  }
  report.planProgressRate = turns.length ? report.progressTurns / turns.length : null;
  report.turnsFromCandidateSelectionToItinerary = report.selections.length && report.selections.every((s) => s.turnsToDraft !== null) ?
    Math.max(...report.selections.map((s) => s.turnsToDraft!)) : null;
  for (const metric of ["ttfc", "ttfi"] as const) {
    const limit = thresholds[metric];
    if (limit !== undefined && (report[metric] === null || report[metric] > limit)) report.failures.push(`${metric}: ${report[metric] ?? "not_reached"} (<= ${limit})`);
  }
  for (const selection of report.selections) {
    if (selection.turnsToDraft === null || selection.turnsToDraft > thresholds.selectionToDraft) {
      report.failures.push(`selection@${selection.beforeAssistantTurn}: ${selection.turnsToDraft ?? "not_reached"} (<= ${thresholds.selectionToDraft})`);
    }
  }
  if (report.maximumOrdinaryQuestionOnlyStreak > thresholds.maximumOrdinaryAskOnlyStreak) {
    report.failures.push("ordinary ask_only loop"); reasons.add("ask_only_loop");
  }
  if (report.missingObservationTurns.length) report.failures.push("missing turn observation");
  if (!turns.length) report.failures.push("no assistant response observed");
  if (report.ttfc !== null && report.ttfi === null) {
    reasons.add("candidate_only");
    if (!report.selections.length) reasons.add("candidate_not_selected");
  }
  if (!report.progressTurns) reasons.add("no_visible_progress");
  if (report.failures.length && !reasons.size) reasons.add("unknown");
  report.failureReasons = [...reasons].sort();
  report.modelCalls = completeSum(turns.map((t) => t.modelCalls));
  report.toolCalls = completeSum(turns.map((t) => t.trace && !t.trace.droppedEventCount ? t.trace.events.filter((e) => e.type === "tool_called").length : undefined));
  report.latencyMs = completeSum(turns.map((t) => t.trace?.events.flatMap((e) => e.type === "task_completed" ? [e.latencyMs] : []).at(-1)));
  report.passed = report.failures.length === 0;
  return report;
}

function completeSum(values: Array<number | undefined>): number | null {
  return values.length && values.every((v) => v !== undefined && Number.isFinite(v) && v >= 0) ? values.reduce<number>((sum, v) => sum + v!, 0) : null;
}

/** Deliberately excludes prompts, response text, artifact refs, exception missingFact and raw trace. */
export function renderTravelProgressMarkdown(reports: readonly TravelProgressReport[]): string {
  return "\n## Trip Progress（assistant response = 1 turn）\n\n" + reports.map((r) => {
    const milestone = (key: "ttfc" | "ttfi") => `${r[key] ?? "未到達"}${r.thresholds[key] === undefined ? "（閾値対象外）" : ` / <=${r.thresholds[key]}`}`;
    return `### ${r.id}: ${r.passed ? "PASS" : r.mode === "live" && !r.contractFailures.length ? "WARN" : "FAIL"}\n\n` +
      `- TTFC: ${milestone("ttfc")}; TTFI: ${milestone("ttfi")}\n` +
      `- Selection → draft: ${r.selections.map((s) => `turn ${s.beforeAssistantTurn} → ${s.turnsToDraft ?? "未到達"}`).join(", ") || "選択イベントなし"}\n` +
      `- Ask-only streak: ${r.maximumQuestionOnlyStreak}（通常 ${r.maximumOrdinaryQuestionOnlyStreak}）; ask_only ${r.askOnlyTurns}; ask_and_progress ${r.askAndProgressTurns}\n` +
      `- 例外: ${r.exceptions.map((e) => `turn ${e.turn}: ${e.reason}`).join(", ") || "なし"}; 既知条件の再質問 ${r.repeatedKnownConditionQuestions}\n` +
      `- Progress rate: ${r.planProgressRate === null ? "未計測" : `${Math.round(r.planProgressRate * 100)}%`} (${r.progressTurns}/${r.eligibleAssistantTurns})\n` +
      `- Model calls: ${r.modelCalls ?? "未計測"}; Tool calls: ${r.toolCalls ?? "未計測"}; latency: ${r.latencyMs ?? "未計測"} ms; trace incomplete: ${r.traceIncomplete}\n` +
      `- 理由: ${r.failureReasons.join(", ") || "なし"}\n- 閾値/契約違反: ${r.failures.join("; ") || "なし"}\n`;
  }).join("\n") + "\nLiveのturn閾値は警告。Scriptedの閾値と既存のgrounding/安全性は独立して検証する。Progress rateはnon-gating。\n";
}
