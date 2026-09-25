import type { AgentTurnOutcome, VisibleProgress } from "./agent-turn-outcome";

export const agentTaskPhases = ["discovery", "draft", "refine", "in_trip"] as const;
export type AgentTaskPhase = typeof agentTaskPhases[number];
export type AgentProgressKind = VisibleProgress["kind"];

export interface AgentTaskContext {
  version: 1;
  phase: AgentTaskPhase;
  target: { kind: "conversation"; conversationId?: string } |
    { kind: "trip"; tripId: string; tripRevision?: number };
  requestRevision?: number;
  workingStateRevision?: number;
  availableProgressKinds: AgentProgressKind[];
  previousOutcome?: AgentTurnOutcome;
  /** Application-derived current-turn meaning change. Models cannot assert this field. */
  currentIntentChange?: {
    intentRevision: number;
    operations: Array<{
      action: import("@raiquora/trip/conversation-intent").IntentOperationKind;
      target: import("@raiquora/trip/conversation-intent").IntentTarget;
    }>;
  };
  researchTarget?: { presentationId: string; candidateSetId?: string; candidateSetRevision?: number; tripId?: string; baseTripRevision?: number };
}

export function deriveAgentTaskContext(input: {
  conversationId?: string;
  trip?: Record<string, unknown>;
  consultationRequest?: unknown;
  requestRevision?: number;
  workingStateRevision?: number;
  previousOutcome?: AgentTurnOutcome;
}): AgentTaskContext {
  const tripId = text(input.trip?.tripId) ?? text(input.trip?.id);
  const tripRevision = integer(input.trip?.revision);
  const lifecycle = text(input.trip?.lifecycleState);
  const phase: AgentTaskPhase = tripId
    ? lifecycle === "in_trip" || lifecycle === "active" ? "in_trip" : "refine"
    : input.consultationRequest === undefined ? "discovery" : "draft";
  const target = tripId
    ? { kind: "trip" as const, tripId, ...(tripRevision === undefined ? {} : { tripRevision }) }
    : { kind: "conversation" as const, ...(input.conversationId ? { conversationId: input.conversationId } : {}) };
  return {
    version: 1,
    phase,
    target,
    ...(integer(input.requestRevision) === undefined && tripRevision === undefined ? {} :
      { requestRevision: integer(input.requestRevision) ?? tripRevision! }),
    ...(input.workingStateRevision === undefined ? {} : { workingStateRevision: input.workingStateRevision }),
    availableProgressKinds: phase === "in_trip"
      ? ["grounded_decision", "trip_proposal", "itinerary"]
      : ["candidates", "comparison", "trip_proposal", "itinerary", "grounded_decision", "checklist_proposal"],
    ...(input.previousOutcome ? { previousOutcome: input.previousOutcome } : {}),
  };
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
function integer(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}
