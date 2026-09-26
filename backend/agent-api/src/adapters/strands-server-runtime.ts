import { mergeEvidenceObservations, validateEvidenceAndClaims } from "@raiquora/agent/evidence-model";
import type { AgentRuntimeResult } from "@raiquora/agent/runtime-contract";
import { AgentV2ReplyError, type AgentV2ReplyProof } from "@raiquora/agent/agent-v2-reply";
import { admitAgentV2Reply } from "@raiquora/agent/agent-v2-publication";
import type { ServerAgentRuntimeInput } from "../ports/server-agent-runtime.js";
import { StrandsAgentEngine } from "./strands-agent-engine.js";
import { strandsTurnInput } from "./strands-turn-input.js";

/** Proof is Application-authored and intended for V2 evaluation/diagnostics. It
 * does not authorize mutations and is not a second Conversation state store. */
export type StrandsRuntimeResult = AgentRuntimeResult & { publicReply?: AgentV2ReplyProof; publicationError?: string };
export function createStrandsServerRuntime(engine: StrandsAgentEngine) {
  return async (input: ServerAgentRuntimeInput): Promise<StrandsRuntimeResult> => {
    const run = await engine.run({
      executionId: input.executionId, userRequest: input.userRequest, modelInput: strandsTurnInput(input),
      tools: input.tools, toolExecutor: input.toolExecutor, effectiveIntent: input.context?.effectiveIntent,
      limits: { maxTurns: Math.min(input.limits.maxIterations, input.limits.maxModelCalls),
        maxToolCalls: input.limits.maxToolCalls, maxExecutionMs: input.limits.maxExecutionMs },
      reserveToolCall: () => input.researchLedger.reserve("toolCalls"),
    });
    accountStrandsUsage(input.researchLedger, run.metrics);
    const status = runtimeStatus(run.stopReason, run.limitReason);
    const denied = (publicationError: string): StrandsRuntimeResult => ({
      status: status === "completed" ? "failed" : status,
      response: "", evidence: [], claims: [], trace: run.trace, publicationError,
      delivery: { status: "degraded", basis: "verified_projection" },
    });
    if (status !== "completed") return denied("incomplete_execution");
    if (!run.replyProposal) return denied("missing_reply_proposal");
    // Merge rather than silently choosing the first of colliding evidence IDs.
    const merged = mergeEvidenceObservations([], [...(input.initialEvidence ?? []), ...run.evidence], input.limits.maxEvidence);
    if (merged.collisions.length || merged.conflictingObservationIds.length) return denied("evidence_collision");
    try {
      const reply = admitAgentV2Reply(run.replyProposal, {
        executionId: input.executionId, evidence: merged.evidence, effectiveIntent: input.context?.effectiveIntent,
        // This composition exposes reads only. No model-supplied success receipts.
        receipts: [], availableOperations: [],
      });
      // Match the existing Conversation message envelope before committing a reply.
      // Count UTF-8 bytes after rendering/escaping, not source characters.
      if (Buffer.byteLength(reply.text, "utf8") > 16 * 1024) return denied("response_budget");
      const validation = validateEvidenceAndClaims(reply.evidence, reply.claims);
      if (!validation.valid) return denied("invalid_claim_binding");
      return { status: "completed", response: reply.text, evidence: reply.evidence,
        claims: validation.claims, trace: run.trace, publicReply: reply.proof,
        delivery: { status: "full", basis: "verified_projection" } };
    } catch (error) {
      if (error instanceof AgentV2ReplyError) return denied(error.code);
      throw error;
    }
  };
}
function accountStrandsUsage(ledger: ServerAgentRuntimeInput["researchLedger"],
  metrics: Awaited<ReturnType<StrandsAgentEngine["run"]>>["metrics"]): void {
  if (!metrics) return;
  for (let index = 0; index < metrics.modelCalls; index += 1) ledger.reserve("modelCalls");
  ledger.recordModel({ inputTokens: metrics.inputTokens, outputTokens: metrics.outputTokens, totalTokens: metrics.totalTokens,
    ...(metrics.cacheReadInputTokens === undefined ? {} : { cacheReadInputTokens: metrics.cacheReadInputTokens }),
    ...(metrics.cacheWriteInputTokens === undefined ? {} : { cacheWriteInputTokens: metrics.cacheWriteInputTokens }),
  }, metrics.cacheReadInputTokens ? "read" : metrics.cacheWriteInputTokens ? "write" : "unknown");
}
function runtimeStatus(stopReason: string, limitReason?: "tool_calls" | "deadline"): AgentRuntimeResult["status"] {
  if (limitReason) return "limit_reached";
  if (stopReason === "endTurn" || stopReason === "stopSequence") return "completed";
  if (["limitTurns", "limitTotalTokens", "limitOutputTokens", "maxTokens", "modelContextWindowExceeded"].includes(stopReason)) return "limit_reached";
  return "failed";
}
