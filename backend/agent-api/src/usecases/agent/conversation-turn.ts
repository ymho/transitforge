import type { AgentRuntimeResult } from "@raiquora/agent/runtime-contract";
import { StateError, exactObject, requireStatePrincipal } from "../../contracts/server-state.js";
import type { ConversationTurnContinuity, ConversationTurnRepository, ConversationTurnResult } from "../../ports/conversation-turn-repository.js";
import type { ServerAgentTurn } from "./server-agent.js";
import { presentationFromObservation, presentationFromPublicPlan } from "@raiquora/agent/conversation-working-state";
import { semanticStateOf } from "@raiquora/agent/conversation-working-state";
import { acceptedIntentDeltaFromInterpretation, type UtteranceInterpretation } from "@raiquora/agent/semantic-interpretation";
import type { AgentDiagnosticEvent, AgentDiagnosticsSink } from "../../ports/agent-diagnostics.js";
import { reserveResearchResultSave } from "@raiquora/agent/research-execution";
import type { AgentProgressReporter } from "@raiquora/agent/agent-progress";
import { publicSemanticReceipt, type PublicSemanticReceipt } from "@raiquora/agent/public-semantic-receipt";

export class ConversationTurnExecutionError extends Error {
  constructor(readonly code: "limit_reached" | "agent_failed") { super(code); }
}

export interface ConversationTurnInput extends ServerAgentTurn { conversationId: string; turnId: string }
/** The sequence cutoff is trusted server state, never a client-selected history boundary. */
export function createConversationTurnApplication(dependencies: {
  turns: ConversationTurnRepository;
  runAgentTurn: (input: ServerAgentTurn, historyBeforeSequence: number, reportProgress?: AgentProgressReporter) => Promise<AgentRuntimeResult & Pick<ConversationTurnResult, "tripUpdateProposal" | "consultationRequestProposal" | "tripCostProposal">>;
  interpretIntent?: (input: { userRequest: string; calendarDate?: string; overlay: import("@raiquora/trip/conversation-intent").ConversationIntentOverlay;
    turnId: string; workingState?: import("@raiquora/agent/conversation-working-state").ConversationWorkingState }) => Promise<UtteranceInterpretation>;
  diagnostics?: AgentDiagnosticsSink;
  log?: (event: string, fields: Record<string, unknown>) => void;
}) {
  return { async runConversationTurn(input: ConversationTurnInput, reportProgress?: AgentProgressReporter,
    reportIntentAccepted?: (receipt: PublicSemanticReceipt) => Promise<void>): Promise<ConversationTurnResult> {
    exactObject(input, ["principal", "conversationId", "turnId", "userRequest", "requestedResearchMode", "researchTarget", "tripId", "uiContext"]);
    requireStatePrincipal(input.principal);
    const snapshot = structuredClone(input);
    const { principal, conversationId, turnId, userRequest, requestedResearchMode, researchTarget, tripId, uiContext } = snapshot;
    const identity = { principal, conversationId, turnId };
    const begun = await dependencies.turns.beginTurn(identity, { userRequest, requestedResearchMode, researchTarget, tripId, uiContext });
    await safeDiagnostic(dependencies, { version: "agent-diagnostic-v1", executionId: turnId, phase: "authorize", reason: "validated",
      occurredAt: new Date().toISOString(), correlation: { turnId, schemaVersion: "semantic-v1", ruleVersion: "intent-v1" } });
    if (begun.state === "completed") return begun.result;
    let acceptedReceipt = begun.state === "intent_accepted" ? begun.receipt : undefined;
    if (acceptedReceipt) {
      await reportIntentAccepted?.(publicSemanticReceipt(acceptedReceipt));
      await safeDiagnostic(dependencies, semanticDiagnostic(turnId, "publish", "completed", acceptedReceipt));
    }
    let result: ConversationTurnResult;
    let continuity: ConversationTurnContinuity | undefined;
    try {
      if (begun.state === "started" && dependencies.interpretIntent) {
        const workingState = await dependencies.turns.getWorkingState(principal, conversationId);
        const semantic = semanticStateOf(workingState);
        await safeDiagnostic(dependencies, { version: "agent-diagnostic-v1", executionId: turnId, phase: "interpret", reason: "started",
          occurredAt: new Date().toISOString(), correlation: { turnId, intentRevision: semantic.overlay.intentRevision, schemaVersion: "semantic-v1", ruleVersion: "intent-v1" } });
        const interpretation = await dependencies.interpretIntent({ userRequest, calendarDate: uiContext?.calendarDate, overlay: semantic.overlay, turnId,
          ...(workingState ? { workingState } : {}) });
        await safeDiagnostic(dependencies, { version: "agent-diagnostic-v1", executionId: turnId, phase: "interpret",
          reason: interpretation.outcome === "delta" ? "validated" : interpretation.outcome,
          occurredAt: new Date().toISOString(), correlation: { turnId, intentRevision: semantic.overlay.intentRevision, schemaVersion: "semantic-v1", ruleVersion: "intent-v1" },
          counts: { generated: interpretation.operations.length }, incomplete: interpretation.outcome === "ambiguous" || interpretation.outcome === "unsupported" });
        const delta = acceptedIntentDeltaFromInterpretation({ interpretation, userRequest, turnId,
          baseIntentRevision: semantic.overlay.intentRevision, calendarDate: uiContext?.calendarDate, ...(workingState ? { workingState } : {}) });
        if (delta) {
          await safeDiagnostic(dependencies, { version: "agent-diagnostic-v1", executionId: turnId, phase: "resolve", reason: "validated",
            occurredAt: new Date().toISOString(), correlation: { turnId, intentRevision: semantic.overlay.intentRevision, schemaVersion: "semantic-v1", ruleVersion: "intent-v1" },
            counts: { validated: delta.operations.length }, refs: delta.operations.map(({ operationId }) => operationId) });
          const receipt = await dependencies.turns.acceptIntent(identity, begun.lease, delta);
          acceptedReceipt = receipt;
          await safeDiagnostic(dependencies, semanticDiagnostic(turnId, "reduce", "completed", receipt));
          await safeDiagnostic(dependencies, semanticDiagnostic(turnId, "accept", "accepted", receipt));
          await reportIntentAccepted?.(publicSemanticReceipt(receipt));
          await safeDiagnostic(dependencies, semanticDiagnostic(turnId, "publish", "completed", receipt));
        }
      }
      const runtimeInput = { principal, conversationId, userRequest, requestedResearchMode, researchTarget, tripId, uiContext };
      const runtime = reportProgress
        ? await dependencies.runAgentTurn(runtimeInput, begun.lease.userSequence, reportProgress)
        : await dependencies.runAgentTurn(runtimeInput, begun.lease.userSequence);
      if (runtime.status !== "completed" && runtime.status !== "follow_up") {
        throw new ConversationTurnExecutionError(runtime.status === "limit_reached" ? "limit_reached" : "agent_failed");
      }
      const presentationReceipt = runtime.publicPlanPresentation ? presentationFromPublicPlan(runtime.publicPlanPresentation) : presentationFromObservation(turnId, runtime.turnObservation);
      if (presentationReceipt) await safeDiagnostic(dependencies, { version: "agent-diagnostic-v1", executionId: turnId,
        phase: "presentation", reason: "validated", occurredAt: new Date().toISOString(), correlation: { turnId },
        counts: { validated: 1 }, refs: [presentationReceipt.presentationId] });
      result = { status: runtime.status, response: runtime.response,
        ...(runtime.delivery ? { delivery: runtime.delivery } : {}),
        ...(acceptedReceipt ? { semanticReceipt: publicSemanticReceipt(acceptedReceipt) } : {}),
        ...(runtime.publicPlanPresentation ? { publicPlanPresentation: runtime.publicPlanPresentation } : {}),
        ...(runtime.publicJourneyPresentation ? { publicJourneyPresentation: runtime.publicJourneyPresentation } : {}),
        ...(runtime.researchExecution ? { researchExecution: reserveResearchResultSave(runtime.researchExecution) } : {}),
        ...(runtime.turnObservation ? { turnObservation: runtime.turnObservation } : {}),
        ...(presentationReceipt ? { presentationReceipt } : {}),
        ...(runtime.tripCostProposal ? { tripCostProposal: runtime.tripCostProposal } : {}), ...(runtime.tripUpdateProposal ? { tripUpdateProposal: runtime.tripUpdateProposal } : {}), ...(runtime.consultationRequestProposal ? { consultationRequestProposal: runtime.consultationRequestProposal } : {}) };
      await safeDiagnostic(dependencies, { version: "agent-diagnostic-v1", executionId: turnId, phase: "respond", reason: "validated",
        occurredAt: new Date().toISOString(), correlation: { turnId, ...(acceptedReceipt ? { intentRevision: acceptedReceipt.intentRevision } : {}) },
        counts: { acceptedCharacters: runtime.response.length } });
      const publishedEvidenceIds = [...new Set([
        ...(runtime.publicPlanPresentation?.evidenceRefs ?? []),
        ...(runtime.publicPlanPresentation?.photoRefs ?? []),
        ...(runtime.publicJourneyPresentation?.evidenceRefs ?? []),
        ...(runtime.claims ?? []).flatMap((claim) => claim.evidenceIds),
      ])];
      continuity = { publishedEvidenceIds, evidence: runtime.evidence ?? [] };
    } catch (error) {
      // Best effort only. If recording failure is unavailable, lease expiry enables recovery.
      try { await dependencies.turns.failTurn(identity, begun.lease); } catch { /* No raw exception/trace retention. */ }
      await safeDiagnostic(dependencies, { version: "agent-diagnostic-v1", executionId: turnId, phase: "save", reason: "failed",
        occurredAt: new Date().toISOString(), correlation: { turnId }, incomplete: true });
      if (error instanceof ConversationTurnExecutionError) throw error;
      throw new StateError("unavailable");
    }
    // An ambiguous completion must not transition to failed: the transaction may have committed.
    let completed: ConversationTurnResult;
    try { completed = await dependencies.turns.completeTurn(identity, begun.lease, result, continuity); }
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

function semanticDiagnostic(turnId: string, phase: "reduce" | "accept" | "publish", reason: "accepted" | "completed",
  receipt: import("@raiquora/agent/conversation-intent-reducer").IntentApplicationReceipt): AgentDiagnosticEvent {
  return { version: "agent-diagnostic-v1", executionId: turnId, phase, reason, occurredAt: new Date().toISOString(),
    correlation: { turnId, intentRevision: receipt.intentRevision, schemaVersion: "semantic-v1", ruleVersion: "intent-v1" },
    counts: { validated: receipt.operations.filter(({ status }) => status === "accepted").length },
    refs: receipt.operations.map(({ operationId }) => operationId) };
}

async function safeDiagnostic(
  dependencies: { diagnostics?: AgentDiagnosticsSink; log?: (event: string, fields: Record<string, unknown>) => void },
  event: AgentDiagnosticEvent,
): Promise<void> {
  if (!dependencies.diagnostics) return;
  try { await dependencies.diagnostics.record(event); }
  catch { dependencies.log?.("agent_diagnostic_dropped", { executionId: event.executionId, phase: event.phase }); }
}
