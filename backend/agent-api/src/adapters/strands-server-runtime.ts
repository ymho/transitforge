import { agentDecisionContextText, buildAgentDecisionContext } from "@raiquora/agent/agent-decision-context";
import { validateEvidenceAndClaims, type Evidence } from "@raiquora/agent/evidence-model";
import { presentGroundedEvidence } from "@raiquora/agent/grounded-answer";
import type { AgentRuntimeResult } from "@raiquora/agent/runtime-contract";
import type { ServerAgentRuntimeRunner } from "../ports/server-agent-runtime.js";
import { StrandsAgentEngine } from "./strands-agent-engine.js";

export function createStrandsServerRuntime(engine: StrandsAgentEngine): ServerAgentRuntimeRunner {
  return async (input): Promise<AgentRuntimeResult> => {
    const decisionContext = buildAgentDecisionContext({
      executionId: input.executionId,
      feature: "concierge",
      userRequest: input.userRequest,
      researchMode: input.researchMode,
      ...(input.context ? { context: input.context } : {}),
      ...(input.initialEvidence?.length ? { initialEvidence: input.initialEvidence } : {}),
    }, input.tools.descriptors());

    const run = await engine.run({
      executionId: input.executionId,
      userRequest: input.userRequest,
      modelInput: agentDecisionContextText(decisionContext),
      tools: input.tools,
      toolExecutor: input.toolExecutor,
      effectiveIntent: decisionContext.effectiveIntent,
    });

    accountStrandsUsage(input.researchLedger, run.metrics);
    const evidence = uniqueEvidence([...(input.initialEvidence ?? []), ...run.evidence], input.limits.maxEvidence);
    const status = runtimeStatus(run.stopReason);

    if (status !== "completed") {
      return {
        status,
        response: "",
        evidence,
        claims: [],
        trace: run.trace,
        delivery: { status: "degraded", basis: "verified_projection" },
      };
    }

    if (evidence.length) {
      try {
        const grounded = presentGroundedEvidence(evidence.map(({ id }) => id), evidence);
        const validation = validateEvidenceAndClaims(evidence, grounded.claims);
        if (!validation.valid) throw new Error("Invalid grounded Strands claims");
        return {
          status: "completed",
          response: grounded.text,
          evidence,
          claims: validation.claims,
          trace: run.trace,
          delivery: { status: "full", basis: "verified_projection" },
        };
      } catch {
        return {
          status: "failed",
          response: "",
          evidence,
          claims: [],
          trace: run.trace,
          delivery: { status: "degraded", basis: "verified_projection" },
        };
      }
    }

    return {
      status: "completed",
      response: run.response,
      evidence: [],
      claims: [],
      trace: run.trace,
      delivery: { status: "full", basis: "model" },
    };
  };
}

function accountStrandsUsage(
  ledger: Parameters<ServerAgentRuntimeRunner>[0]["researchLedger"],
  metrics: Awaited<ReturnType<StrandsAgentEngine["run"]>>["metrics"],
): void {
  if (!metrics) return;
  for (let index = 0; index < metrics.modelCalls; index += 1) ledger.reserve("modelCalls");
  for (let index = 0; index < metrics.toolCalls; index += 1) ledger.reserve("toolCalls");
  ledger.recordModel({
    inputTokens: metrics.inputTokens,
    outputTokens: metrics.outputTokens,
    totalTokens: metrics.totalTokens,
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

function runtimeStatus(stopReason: string): AgentRuntimeResult["status"] {
  if (stopReason === "endTurn" || stopReason === "stopSequence") return "completed";
  if (["limitTurns", "limitTotalTokens", "limitOutputTokens", "maxTokens", "modelContextWindowExceeded"].includes(stopReason)) return "limit_reached";
  return "failed";
}
