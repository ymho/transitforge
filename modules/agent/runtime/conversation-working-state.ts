import type { AgentTurnObservation } from "./agent-turn-outcome";
import { validateEvidenceAndClaims, type Evidence } from "./evidence-model";

export const conversationEvidenceLimits = { maximumItems: 24, maximumBytes: 64_000, maximumItemBytes: 8_000 } as const;

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
  /** Published, bounded source Evidence only. Never raw Tool output or prohibited content. */
  groundingEvidence?: Evidence[];
  lastOutcome?: AgentTurnObservation;
}

export function parseConversationWorkingState(value: unknown): ConversationWorkingState {
  if (!record(value) || !only(value, ["version", "revision", "sourceTurnId", "sourceUserSequence", "target", "presentations",
    "pendingQuestionRefs", "pendingProposalRefs", "groundingEvidence", "lastOutcome"]) || value.version !== 1 || !integer(value.revision) || !identifier(value.sourceTurnId) ||
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
  const groundingEvidence = value.groundingEvidence === undefined ? undefined : parseConversationEvidence(value.groundingEvidence);
  return structuredClone({ ...value, presentations, ...(groundingEvidence ? { groundingEvidence } : {}) }) as ConversationWorkingState;
}

/** Persist only Evidence that crossed a validated public boundary. Older published
 * sources remain addressable until the bounded LRU budget evicts them. */
export function retainConversationEvidence(
  previous: readonly Evidence[] | undefined,
  current: readonly Evidence[],
  publishedEvidenceIds: readonly string[],
): Evidence[] {
  const selected = new Set(publishedEvidenceIds);
  const additions = current.filter((item) => selected.has(item.id) && conversationSourceEvidence(item));
  const byId = new Map<string, Evidence>();
  for (const item of [...(previous ?? []), ...additions]) {
    if (!conversationSourceEvidence(item)) continue;
    byId.delete(item.id);
    byId.set(item.id, structuredClone(item));
  }
  const newest = [...byId.values()].slice(-conversationEvidenceLimits.maximumItems);
  const retained: Evidence[] = [];
  let bytes = 2;
  for (const item of newest.reverse()) {
    const itemBytes = encodedBytes(item);
    if (itemBytes > conversationEvidenceLimits.maximumItemBytes || bytes + itemBytes + 1 > conversationEvidenceLimits.maximumBytes) continue;
    retained.unshift(item); bytes += itemBytes + 1;
  }
  return parseConversationEvidence(retained);
}

/** Evidence is supplied through AgentRuntimeRequest.initialEvidence, not duplicated
 * inside the model-visible Working State JSON. */
export function workingStateWithoutEvidence(state: ConversationWorkingState): ConversationWorkingState {
  const { groundingEvidence: _groundingEvidence, ...visible } = state;
  return structuredClone(visible);
}

function parseConversationEvidence(value: unknown): Evidence[] {
  if (!Array.isArray(value) || value.length > conversationEvidenceLimits.maximumItems || encodedBytes(value) > conversationEvidenceLimits.maximumBytes ||
      value.some((item) => encodedBytes(item) > conversationEvidenceLimits.maximumItemBytes)) throw new Error("Invalid conversation Evidence");
  const evidence = structuredClone(value) as Evidence[];
  if (evidence.some((item) => !conversationSourceEvidence(item)) || !validateEvidenceAndClaims(evidence, []).valid) {
    throw new Error("Invalid conversation Evidence");
  }
  return evidence;
}

function conversationSourceEvidence(item: Evidence): boolean {
  if (item.observation?.retention !== "bounded_excerpt") return false;
  const facts = item.facts;
  const source = typeof facts.sourceExcerpt === "string" && typeof facts.sourceUrl === "string";
  const photo = typeof facts.imageUrl === "string" && typeof facts.imageSourceUrl === "string" && typeof facts.imageAttribution === "string";
  return source || photo;
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
function encodedBytes(value: unknown): number { try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; } catch { return Number.POSITIVE_INFINITY; } }
