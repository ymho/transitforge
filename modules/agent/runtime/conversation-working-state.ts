import type { AgentTurnObservation } from "./agent-turn-outcome";

export interface PresentationReceipt {
  presentationId: string;
  version: 1;
  target?: { tripId: string; baseTripRevision: number };
  candidateSetRef?: import("./public-plan-presentation").PublicPlanPresentation["candidateSetRef"];
  entries: Array<{ ordinal: number; candidateRef: string }>;
}
export interface ConversationWorkingState {
  version: 1;
  revision: number;
  sourceTurnId: string;
  sourceUserSequence: number;
  target: { conversationId: string; tripId?: string; tripRevision?: number };
  presentations: PresentationReceipt[];
  pendingQuestionRefs: string[];
  pendingProposalRefs: string[];
  lastOutcome?: AgentTurnObservation;
}

export function parseConversationWorkingState(value: unknown): ConversationWorkingState {
  if (!record(value) || !only(value, ["version", "revision", "sourceTurnId", "sourceUserSequence", "target", "presentations",
    "pendingQuestionRefs", "pendingProposalRefs", "lastOutcome"]) || value.version !== 1 || !integer(value.revision) || !identifier(value.sourceTurnId) ||
    !Number.isSafeInteger(value.sourceUserSequence) || Number(value.sourceUserSequence) < 1 || !record(value.target) ||
    !only(value.target, ["conversationId", "tripId", "tripRevision"]) ||
    !identifier(value.target.conversationId) || value.target.tripId !== undefined && !identifier(value.target.tripId) ||
    value.target.tripRevision !== undefined && !integer(value.target.tripRevision) || !Array.isArray(value.presentations) ||
    value.presentations.length > 20 || !stringList(value.pendingQuestionRefs, 20) || !stringList(value.pendingProposalRefs, 20) ||
    value.lastOutcome !== undefined && !validOutcome(value.lastOutcome)) throw new Error("Invalid working state");
  const presentations = value.presentations.map((candidate) => {
    if (!record(candidate) || !only(candidate, ["presentationId", "version", "target", "candidateSetRef", "entries"]) || !identifier(candidate.presentationId) || candidate.version !== 1 || !Array.isArray(candidate.entries) ||
      candidate.entries.length > 24) throw new Error("Invalid presentation receipt");
    const entries = candidate.entries.map((entry, index) => {
      if (!record(entry) || !only(entry, ["ordinal", "candidateRef"]) || entry.ordinal !== index + 1 || !reference(entry.candidateRef)) throw new Error("Invalid presentation entry");
      return { ordinal: entry.ordinal as number, candidateRef: entry.candidateRef as string };
    });
    const candidateSetRef = candidate.candidateSetRef === undefined ? undefined : parseCandidateSetRef(candidate.candidateSetRef);
    const target = candidate.target === undefined ? undefined : parsePresentationTarget(candidate.target);
    return { presentationId: candidate.presentationId as string, version: 1 as const, ...(target ? { target } : {}), ...(candidateSetRef ? { candidateSetRef } : {}), entries };
  });
  return structuredClone({ ...value, presentations }) as ConversationWorkingState;
}

export function resolvePresentedCandidate(input: {
  state: ConversationWorkingState;
  presentationId: string;
  version: number;
  ordinal: number;
}): string | undefined {
  if (input.version !== 1 || !Number.isSafeInteger(input.ordinal) || input.ordinal < 1) return undefined;
  const presentation = input.state.presentations.find((value) =>
    value.presentationId === input.presentationId && value.version === input.version);
  return presentation?.entries.find((entry) => entry.ordinal === input.ordinal)?.candidateRef;
}

export function presentationFromObservation(presentationId: string, observation: AgentTurnObservation | undefined): PresentationReceipt | undefined {
  const refs = observation?.progress.flatMap((progress) =>
    progress.kind === "candidates" || progress.kind === "comparison" ? progress.refs : []) ?? [];
  const unique = [...new Set(refs.filter((ref) => ref.trim()))].slice(0, 24);
  return unique.length ? { presentationId, version: 1, entries: unique.map((candidateRef, index) => ({ ordinal: index + 1, candidateRef })) } : undefined;
}

export function presentationFromPublicPlan(value: import("./public-plan-presentation").PublicPlanPresentation): PresentationReceipt {
  return { presentationId: value.presentationId, version: 1, ...(value.target ? { target: structuredClone(value.target) } : {}), candidateSetRef: structuredClone(value.candidateSetRef),
    entries: value.candidateOrder.map((candidateRef, index) => ({ ordinal: index + 1, candidateRef })) };
}
function parsePresentationTarget(value: unknown): NonNullable<PresentationReceipt["target"]> {
  if (!record(value) || !only(value, ["tripId", "baseTripRevision"]) || !reference(value.tripId) || !integer(value.baseTripRevision)) throw new Error("Invalid presentation target receipt");
  return structuredClone(value) as NonNullable<PresentationReceipt["target"]>;
}

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function only(value: Record<string, unknown>, keys: string[]): boolean { const allowed = new Set(keys); return Object.keys(value).every((key) => allowed.has(key)); }
function integer(value: unknown): boolean { return Number.isSafeInteger(value) && Number(value) >= 0; }
function identifier(value: unknown): boolean { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value); }
function reference(value: unknown): boolean { return typeof value === "string" && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f]/u.test(value); }
function stringList(value: unknown, maximum: number): value is string[] { return Array.isArray(value) && value.length <= maximum && value.every(reference); }
function validOutcome(value: unknown): value is AgentTurnObservation {
  if (!record(value) || !only(value, ["outcome", "progress", "exception"]) ||
    !["ask_only", "ask_and_progress", "progress", "answer"].includes(String(value.outcome)) || !Array.isArray(value.progress) || value.progress.length > 12) return false;
  if (!value.progress.every((progress) => record(progress) && only(progress, ["kind", "refs", "mediaRefs"]) &&
    ["candidates", "comparison", "trip_proposal", "itinerary", "grounded_decision", "checklist_proposal"].includes(String(progress.kind)) &&
    stringList(progress.refs, 12) && (progress.mediaRefs === undefined || stringList(progress.mediaRefs, 12)))) return false;
  return value.exception === undefined || record(value.exception) && only(value.exception, ["reason", "missingFact", "constraintId", "toolName", "inputName"]) &&
    ["safety", "hard_constraint_unknown", "tool_input_missing"].includes(String(value.exception.reason)) && reference(value.exception.missingFact) &&
    [value.exception.constraintId, value.exception.toolName, value.exception.inputName].every((item) => item === undefined || reference(item));
}
function parseCandidateSetRef(value: unknown): PresentationReceipt["candidateSetRef"] {
  if (!record(value)) throw new Error("Invalid candidate set receipt");
  if (value.kind === "unavailable" && only(value, ["kind", "reason"]) && ["legacy-projection", "not-retained", "expired"].includes(String(value.reason))) return structuredClone(value) as PresentationReceipt["candidateSetRef"];
  if (value.kind === "candidate-set-ref" && only(value, ["kind", "candidateSetId", "revision", "baseTripRevision"]) && reference(value.candidateSetId) && integer(value.revision) &&
      (value.baseTripRevision === undefined || integer(value.baseTripRevision))) return structuredClone(value) as PresentationReceipt["candidateSetRef"];
  throw new Error("Invalid candidate set receipt");
}
