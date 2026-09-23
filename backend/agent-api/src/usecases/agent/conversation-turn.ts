import type { AgentRuntimeResult } from "@raiquora/agent/runtime-contract";
import { StateError, exactObject, requireStatePrincipal } from "../../contracts/server-state.js";
import type { ConversationTurnRepository, ConversationTurnResult } from "../../ports/conversation-turn-repository.js";
import type { ServerAgentTurn } from "./server-agent.js";
import { presentationFromObservation, presentationFromPublicPlan } from "@raiquora/agent/conversation-working-state";
import type { AgentDiagnosticEvent, AgentDiagnosticsSink } from "../../ports/agent-diagnostics.js";
import { reserveResearchResultSave } from "@raiquora/agent/research-execution";

export interface ConversationTurnInput extends ServerAgentTurn { conversationId: string; turnId: string }
/** The sequence cutoff is trusted server state, never a client-selected history boundary. */
export function createConversationTurnApplication(dependencies: {
  turns: ConversationTurnRepository;
  runAgentTurn: (input: ServerAgentTurn, historyBeforeSequence: number) => Promise<AgentRuntimeResult & Pick<ConversationTurnResult, "tripUpdateProposal" | "consultationRequestProposal" | "tripCostProposal">>;
  diagnostics?: AgentDiagnosticsSink;
  log?: (event: string, fields: Record<string, unknown>) => void;
}) {
  return { async runConversationTurn(input: ConversationTurnInput): Promise<ConversationTurnResult> {
    exactObject(input, ["principal", "conversationId", "turnId", "userRequest", "requestedResearchMode", "researchTarget", "tripId", "uiContext"]);
    requireStatePrincipal(input.principal);
    const snapshot = structuredClone(input);
    const { principal, conversationId, turnId, userRequest, requestedResearchMode, researchTarget, tripId, uiContext } = snapshot;
    const identity = { principal, conversationId, turnId };
    const begun = await dependencies.turns.beginTurn(identity, { userRequest, requestedResearchMode, researchTarget, tripId, uiContext });
    if (begun.state === "completed") return begun.result;
    let result: ConversationTurnResult;
    try {
      const runtime = await dependencies.runAgentTurn({ principal, conversationId, userRequest, requestedResearchMode, researchTarget, tripId, uiContext }, begun.lease.userSequence);
      if (runtime.status !== "completed" && runtime.status !== "follow_up") throw new StateError("unavailable");
      const presentationReceipt = runtime.publicPlanPresentation ? presentationFromPublicPlan(runtime.publicPlanPresentation) : presentationFromObservation(turnId, runtime.turnObservation);
      if (presentationReceipt) await safeDiagnostic(dependencies, { version: "agent-diagnostic-v1", executionId: turnId,
        phase: "presentation", reason: "validated", occurredAt: new Date().toISOString(), correlation: { turnId },
        counts: { validated: 1 }, refs: [presentationReceipt.presentationId] });
      result = { status: runtime.status, response: runtime.response,
        ...(runtime.publicPlanPresentation ? { publicPlanPresentation: runtime.publicPlanPresentation } : {}),
        ...(runtime.researchExecution ? { researchExecution: reserveResearchResultSave(runtime.researchExecution) } : {}),
        ...(runtime.turnObservation ? { turnObservation: runtime.turnObservation } : {}),
        ...(presentationReceipt ? { presentationReceipt } : {}),
        ...(runtime.tripCostProposal ? { tripCostProposal: runtime.tripCostProposal } : {}), ...(runtime.tripUpdateProposal ? { tripUpdateProposal: runtime.tripUpdateProposal } : {}), ...(runtime.consultationRequestProposal ? { consultationRequestProposal: runtime.consultationRequestProposal } : {}) };
    } catch {
      // Best effort only. If recording failure is unavailable, lease expiry enables recovery.
      try { await dependencies.turns.failTurn(identity, begun.lease); } catch { /* No raw exception/trace retention. */ }
      await safeDiagnostic(dependencies, { version: "agent-diagnostic-v1", executionId: turnId, phase: "save", reason: "failed",
        occurredAt: new Date().toISOString(), correlation: { turnId }, incomplete: true });
      throw new StateError("unavailable");
    }
    // An ambiguous completion must not transition to failed: the transaction may have committed.
    let completed: ConversationTurnResult;
    try { completed = await dependencies.turns.completeTurn(identity, begun.lease, result); }
    catch (error) {
      await safeDiagnostic(dependencies, { version: "agent-diagnostic-v1", executionId: turnId, phase: "save", reason: "completion_ambiguous",
        occurredAt: new Date().toISOString(), correlation: { turnId }, incomplete: true });
      throw error;
    }
    await safeDiagnostic(dependencies, { version: "agent-diagnostic-v1", executionId: turnId, phase: "save", reason: "completed",
      occurredAt: new Date().toISOString(), correlation: { turnId }, counts: { published: 1 } });
    return completed;
  } };
}

async function safeDiagnostic(
  dependencies: { diagnostics?: AgentDiagnosticsSink; log?: (event: string, fields: Record<string, unknown>) => void },
  event: AgentDiagnosticEvent,
): Promise<void> {
  if (!dependencies.diagnostics) return;
  try { await dependencies.diagnostics.record(event); }
  catch { dependencies.log?.("agent_diagnostic_dropped", { executionId: event.executionId, phase: event.phase }); }
}
