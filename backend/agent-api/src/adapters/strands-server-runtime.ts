import { validateEvidenceAndClaims, type Evidence } from "@raiquora/agent/evidence-model";
import { presentGroundedEvidence } from "@raiquora/agent/grounded-answer";
import type { AgentRuntimeResult } from "@raiquora/agent/runtime-contract";
import type { ServerAgentRuntimeRunner } from "../ports/server-agent-runtime.js";
import { StrandsAgentEngine } from "./strands-agent-engine.js";
import { strandsTurnInput } from "./strands-turn-input.js";

export function createStrandsServerRuntime(engine: StrandsAgentEngine): ServerAgentRuntimeRunner {
  return async (input): Promise<AgentRuntimeResult> => {
    const run = await engine.run({
      executionId: input.executionId,
      userRequest: input.userRequest,
      modelInput: strandsTurnInput(input),
      tools: input.tools,
      toolExecutor: input.toolExecutor,
      effectiveIntent: input.context?.effectiveIntent,
      limits: {
        maxTurns: Math.min(input.limits.maxIterations, input.limits.maxModelCalls),
        maxToolCalls: input.limits.maxToolCalls,
        maxExecutionMs: input.limits.maxExecutionMs,
      },
      reserveToolCall: () => input.researchLedger.reserve("toolCalls"),
    });
    accountStrandsUsage(input.researchLedger, run.metrics);
    const evidence = uniqueEvidence([...(input.initialEvidence ?? []), ...run.evidence], input.limits.maxEvidence);
    const status = runtimeStatus(run.stopReason, run.limitReason);
    if (status !== "completed") return {
      status, response: "", evidence, claims: [], trace: run.trace,
      delivery: { status: "degraded", basis: "verified_projection" },
    };

    // Temporary verified projection bridge. Replaced by the V2 public-answer
    // contract in #703; this is NOT the intended final conversation experience.
    if (evidence.length) {
      try {
        const grounded = presentGroundedEvidence(evidence.map(({ id }) => id), evidence);
        const validation = validateEvidenceAndClaims(evidence, grounded.claims);
        if (!validation.valid) throw new Error("Invalid grounded Strands claims");
        return { status: "completed", response: grounded.text, evidence,
          claims: validation.claims, trace: run.trace,
          delivery: { status: "full", basis: "verified_projection" } };
      } catch {
        return { status: "failed", response: "", evidence, claims: [], trace: run.trace,
          delivery: { status: "degraded", basis: "verified_projection" } };
      }
    }

    // Missing evidence does not make arbitrary model prose safe to publish.
    // Clarification, ordinary conversation and unsupported-operation replies
    // need explicit admission in #703; do not pass them via a permissive fallback.
    return { status: "failed", response: "", evidence: [], claims: [], trace: run.trace,
      delivery: { status: "degraded", basis: "model" } };
  };
}

function accountStrandsUsage(
  ledger: Parameters<ServerAgentRuntimeRunner>[0]["researchLedger"],
  metrics: Awaited<ReturnType<StrandsAgentEngine["run"]>>["metrics"],
): void {
  if (!metrics) return;
  for (let index = 0; index < metrics.modelCalls; index += 1) ledger.reserve("modelCalls");
  ledger.recordModel({
    inputTokens: metrics.inputTokens, outputTokens: metrics.outputTokens, totalTokens: metrics.totalTokens,
    ...(metrics.cacheReadInputTokens === undefined ? {} : { cacheReadInputTokens: metrics.cacheReadInputTokens }),
    ...(metrics.cacheWriteInputTokens === undefined ? {} : { cacheWriteInputTokens: metrics.cacheWriteInputTokens }),
  }, metrics.cacheReadInputTokens ? "read" : metrics.cacheWriteInputTokens ? "write" : "unknown");
}
function uniqueEvidence(values: readonly Evidence[], maximum: number): Evidence[] {
  const byId = new Map<string, Evidence>();
  for (const item of values) {
    if (!byId.has(item.id)) byId.set(item.id, structuredClone(item));
    if (byId.size >= maximum) break;
  }
  return [...byId.values()];
}
function runtimeStatus(stopReason: string, limitReason?: "tool_calls" | "deadline"): AgentRuntimeResult["status"] {
  if (limitReason) return "limit_reached";
  if (stopReason === "endTurn" || stopReason === "stopSequence") return "completed";
  if (["limitTurns", "limitTotalTokens", "limitOutputTokens", "maxTokens", "modelContextWindowExceeded"].includes(stopReason)) return "limit_reached";
  return "failed";
}
