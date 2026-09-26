import { parsePublicCostProposal } from "@raiquora/trip/public-cost-proposal";
import { parseConsultationRequestProposal } from "@raiquora/trip/consultation-request-proposal";
import { parsePublicRequestProposal } from "@raiquora/trip/public-request-proposal";
import { createHash, randomUUID } from "node:crypto";
import { StateError, exactObject, messageInputs, stateId, type StateClock } from "../contracts/server-state.js";
import type { BeginConversationTurn, ConversationTurnContinuity, ConversationTurnIdentity, ConversationTurnLease, ConversationTurnRepository, ConversationTurnResult } from "../ports/conversation-turn-repository.js";
import { parseConversationWorkingState, retainConversationEvidence, type ConversationWorkingState } from "@raiquora/agent/conversation-working-state";
import { semanticStateOf } from "@raiquora/agent/conversation-working-state";
import { parseAcceptedIntentDelta, type AcceptedIntentDelta } from "@raiquora/trip/conversation-intent";
import { parseIntentApplicationReceipt, reduceConversationIntent, type IntentApplicationReceipt } from "@raiquora/agent/conversation-intent-reducer";
import { parsePublicPlanPresentation } from "@raiquora/agent/public-plan-presentation";
import { parsePublicJourneyPresentation } from "@raiquora/agent/public-journey-presentation";
import { parsePublicPlacePresentation } from "@raiquora/agent/public-place-presentation";
import { parseResearchExecutionOutcome } from "@raiquora/agent/research-execution";
import { parsePublicSemanticReceipt } from "@raiquora/agent/public-semantic-receipt";
import { DynamoDbConversationRepository } from "./dynamodb-conversation-repository.js";
import type { StateDynamoClient, StateEnvelope } from "./dynamodb-state-store.js";
import type { IntentProposalAdoptionPort } from "../ports/intent-proposal-adoption.js";
import type { IntentProposalBinding } from "@raiquora/trip/intent-proposal-binding";
import { TransactWriteItemsCommand } from "@aws-sdk/client-dynamodb";

export const conversationTurnLimits = { leaseMs: 300_000, newTurnMessageLimit: 2_000 } as const;
interface TurnRecord {
  requestHash: string;
  state: "started" | "intent_accepted" | "failed" | "completed";
  attemptId: string;
  leaseUntil: number;
  userSequence: number;
  result?: ConversationTurnResult;
  baseCalendarDate?: string;
  targetTripId?: string;
  intentReceipt?: IntentApplicationReceipt;
}
function finalResult(value: ConversationTurnResult): ConversationTurnResult {
  exactObject(value, ["status", "response", "delivery", "semanticReceipt", "publicPlanPresentation", "publicJourneyPresentation", "publicPlacePresentation", "researchExecution", "tripUpdateProposal", "consultationRequestProposal", "tripCostProposal", "turnObservation", "presentationReceipt"]);
  if (value.status !== "completed" && value.status !== "follow_up") throw new StateError("invalid-input");
  messageInputs([{ role: "assistant", text: value.response }]);
  try {
    if ((value.tripUpdateProposal || value.tripCostProposal) && value.consultationRequestProposal) throw new Error();
    const publicPlanPresentation = value.publicPlanPresentation === undefined ? undefined : parsePublicPlanPresentation(value.publicPlanPresentation);
    const publicJourneyPresentation = value.publicJourneyPresentation === undefined ? undefined : parsePublicJourneyPresentation(value.publicJourneyPresentation);
    const publicPlacePresentation = value.publicPlacePresentation === undefined ? undefined : parsePublicPlacePresentation(value.publicPlacePresentation);
    const researchExecution = value.researchExecution === undefined ? undefined : parseResearchExecutionOutcome(value.researchExecution);
    const semanticReceipt = value.semanticReceipt === undefined ? undefined : parsePublicSemanticReceipt(value.semanticReceipt);
    const delivery = value.delivery === undefined ? undefined : parseDelivery(value.delivery);
    if (value.turnObservation !== undefined && (!value.turnObservation || typeof value.turnObservation !== "object" || !["ask_only", "ask_and_progress", "progress", "answer"].includes(value.turnObservation.outcome))) throw new Error();
    if (value.presentationReceipt !== undefined) parseConversationWorkingState({ version: 1, revision: 0,
      sourceTurnId: "00000000-0000-4000-8000-000000000000", sourceUserSequence: 1,
      target: { conversationId: "00000000-0000-4000-8000-000000000000" }, presentations: [value.presentationReceipt],
      pendingQuestionRefs: [], pendingProposalRefs: [] });
    return { status: value.status, response: value.response,
      ...(delivery ? { delivery } : {}),
      ...(semanticReceipt ? { semanticReceipt } : {}),
      ...(publicPlanPresentation ? { publicPlanPresentation } : {}),
      ...(publicJourneyPresentation ? { publicJourneyPresentation } : {}),
      ...(publicPlacePresentation ? { publicPlacePresentation } : {}),
      ...(researchExecution ? { researchExecution } : {}),
      ...(value.tripCostProposal !== undefined ? { tripCostProposal: parsePublicCostProposal(value.tripCostProposal) } : {}),
      ...(value.tripUpdateProposal !== undefined ? { tripUpdateProposal: parsePublicRequestProposal(value.tripUpdateProposal) } : {}),
      ...(value.consultationRequestProposal !== undefined ? { consultationRequestProposal: parseConsultationRequestProposal(value.consultationRequestProposal) } : {}),
      ...(value.turnObservation !== undefined ? { turnObservation: structuredClone(value.turnObservation) } : {}),
      ...(value.presentationReceipt !== undefined ? { presentationReceipt: structuredClone(value.presentationReceipt) } : {}) };
  } catch { throw new StateError("invalid-input"); }
}

/** Conversation CAS fences delete and every turn transition; no separate table or expiring receipts. */
export class DynamoDbConversationTurnRepository extends DynamoDbConversationRepository implements ConversationTurnRepository, IntentProposalAdoptionPort {
  constructor(table: string, client?: StateDynamoClient, clock?: StateClock, private readonly newAttemptId = randomUUID) {
    super(table, client, clock);
  }
  private identity(input: ConversationTurnIdentity) {
    this.store.owner(input.principal); stateId(input.conversationId); stateId(input.turnId);
    return structuredClone(input);
  }
  private key(input: ConversationTurnIdentity) { return `TURN#${input.conversationId}#${input.turnId}`; }
  private workingKey(conversationId: string) { stateId(conversationId); return `WORKING#${conversationId}`; }
  async getWorkingState(principal: ConversationTurnIdentity["principal"], conversationId: string): Promise<ConversationWorkingState | undefined> {
    this.store.owner(principal);
    const envelope = await this.store.read(principal, this.workingKey(conversationId));
    if (!envelope) return undefined;
    try {
      if (envelope.deleted) throw new Error();
      const state = parseConversationWorkingState(envelope.payload);
      if (state.revision !== envelope.revision || state.target.conversationId !== conversationId) throw new Error();
      return state;
    } catch { throw new StateError("unavailable"); }
  }
  async prepare(principal: ConversationTurnIdentity["principal"], input: { binding: IntentProposalBinding; tripId: string; baseTripRevision: number; mutationId: string }): Promise<void> {
    const binding = structuredClone(input.binding), key = this.workingKey(binding.conversationId);
    stateId(input.tripId); stateId(input.mutationId);
    const old = await this.store.read(principal, key);
    if (!old) throw new StateError("conflict");
    const working = parseConversationWorkingState(old.payload), semantic = semanticStateOf(working);
    if (semantic.adoptions?.some((item) => sameAdoption(item, { ...input, binding }))) return;
    if (semantic.adoptionInFlight) {
      if (sameAdoption(semantic.adoptionInFlight, { ...input, binding })) return;
      throw new StateError("conflict");
    }
    if (working.target.tripId !== input.tripId || working.target.tripRevision !== input.baseTripRevision || semantic.overlay.intentRevision !== binding.intentRevision ||
        !semantic.pendingProposal || semantic.pendingProposal.tripId !== input.tripId || semantic.pendingProposal.baseTripRevision !== input.baseTripRevision ||
        JSON.stringify(semantic.pendingProposal.binding) !== JSON.stringify(binding) || !receiptMatches(semantic.receipts, binding)) throw new StateError("conflict");
    const next = parseConversationWorkingState({ ...working, revision: working.revision + 1,
      semantic: { ...semantic, adoptionInFlight: { binding, tripId: input.tripId, baseTripRevision: input.baseTripRevision, mutationId: input.mutationId } } });
    await this.store.send(new TransactWriteItemsCommand({ TransactItems: [{ Put: this.store.put(principal, key, { revision: next.revision, deleted: false, payload: next }, old) }] }));
  }
  async complete(principal: ConversationTurnIdentity["principal"], input: { binding: IntentProposalBinding; tripId: string; baseTripRevision: number; committedTripRevision: number; mutationId: string }): Promise<void> {
    const binding = structuredClone(input.binding), key = this.workingKey(binding.conversationId);
    stateId(input.tripId); stateId(input.mutationId);
    const old = await this.store.read(principal, key);
    if (!old) throw new StateError("conflict");
    const working = parseConversationWorkingState(old.payload), semantic = semanticStateOf(working);
    if (semantic.adoptions?.some((item) => sameAdoption(item, { ...input, binding }) && item.committedTripRevision === input.committedTripRevision)) return;
    if (!semantic.adoptionInFlight || !sameAdoption(semantic.adoptionInFlight, { ...input, binding }) || input.committedTripRevision !== input.baseTripRevision + 1) throw new StateError("conflict");
    const receipt = semantic.receipts.find((item) => item.intentRevision === binding.intentRevision && receiptMatches([item], binding));
    if (!receipt) throw new StateError("conflict");
    const selected = new Set(binding.changes.map(({ changeRef }) => changeRef));
    const factRefs = new Set(receipt.operations.filter(({ operationId }) => selected.has(operationId)).flatMap(({ afterFactRefs }) => afterFactRefs));
    const overlay = { ...semantic.overlay, facts: semantic.overlay.facts.filter(({ factId }) => !factRefs.has(factId)),
      tombstones: semantic.overlay.tombstones.filter(({ sourceOperationId }) => !selected.has(sourceOperationId)) };
    const adoption = { binding, tripId: input.tripId, baseTripRevision: input.baseTripRevision, committedTripRevision: input.committedTripRevision, mutationId: input.mutationId };
    const next = parseConversationWorkingState({ ...working, revision: working.revision + 1,
      target: { ...working.target, tripRevision: input.committedTripRevision }, pendingProposalRefs: working.pendingProposalRefs.filter((ref) => ref !== "trip_update"),
      semantic: { overlay, receipts: semantic.receipts, adoptions: [...(semantic.adoptions ?? []), adoption].slice(-20) } });
    await this.store.send(new TransactWriteItemsCommand({ TransactItems: [{ Put: this.store.put(principal, key, { revision: next.revision, deleted: false, payload: next }, old) }] }));
  }
  async release(principal: ConversationTurnIdentity["principal"], input: { binding: IntentProposalBinding; tripId: string; baseTripRevision: number; mutationId: string }): Promise<void> {
    const binding = structuredClone(input.binding), key = this.workingKey(binding.conversationId), old = await this.store.read(principal, key);
    if (!old) return;
    const working = parseConversationWorkingState(old.payload), semantic = semanticStateOf(working);
    if (!semantic.adoptionInFlight || !sameAdoption(semantic.adoptionInFlight, { ...input, binding })) return;
    const { adoptionInFlight: _reservation, ...rest } = semantic;
    const next = parseConversationWorkingState({ ...working, revision: working.revision + 1, semantic: rest });
    await this.store.send(new TransactWriteItemsCommand({ TransactItems: [{ Put: this.store.put(principal, key, { revision: next.revision, deleted: false, payload: next }, old) }] }));
  }
  private decodeTurn(envelope: StateEnvelope): TurnRecord {
    try {
      const value = envelope.payload;
      exactObject(value, ["requestHash", "state", "attemptId", "leaseUntil", "userSequence", "result", "baseCalendarDate", "targetTripId", "intentReceipt"]);
      if (envelope.deleted || typeof value.requestHash !== "string" || !/^[0-9a-f]{64}$/.test(value.requestHash) ||
        typeof value.state !== "string" || !["started", "intent_accepted", "failed", "completed"].includes(value.state) ||
        !Number.isSafeInteger(value.leaseUntil) || Number(value.leaseUntil) < 0 ||
        !Number.isSafeInteger(value.userSequence) || Number(value.userSequence) < 1) throw new Error();
      stateId(value.attemptId);
      if (value.baseCalendarDate !== undefined && (typeof value.baseCalendarDate !== "string" || !validCalendarDate(value.baseCalendarDate))) throw new Error();
      if (value.targetTripId !== undefined) stateId(value.targetTripId);
      if (value.intentReceipt !== undefined) parseIntentApplicationReceipt(value.intentReceipt);
      if (value.state === "intent_accepted" && value.intentReceipt === undefined) throw new Error();
      if (value.state === "completed") finalResult(value.result as ConversationTurnResult);
      else if (value.result !== undefined) throw new Error();
      return value as unknown as TurnRecord;
    } catch { throw new StateError("unavailable"); }
  }
  private async read(input: ConversationTurnIdentity) {
    const current = await this.get(input.principal, input.conversationId);
    if (!current) throw new StateError("not-found");
    const old = await this.store.read(input.principal, this.key(input));
    const turn = old ? this.decodeTurn(old) : undefined;
    if (turn?.result?.consultationRequestProposal && turn.result.consultationRequestProposal.conversationId !== input.conversationId) throw new StateError("unavailable");
    const latest = await this.get(input.principal, input.conversationId);
    if (!latest) throw new StateError("not-found");
    if (latest.revision !== current.revision) throw new StateError("conflict");
    if (turn && turn.userSequence > current.messageCount) throw new StateError("unavailable");
    return { current, old, turn };
  }
  async beginTurn(identity: ConversationTurnIdentity, request: { userRequest: string; requestedResearchMode?: "standard" | "detailed"; researchTarget?: import("../contracts/server-state.js").ResearchTarget; tripId?: string; uiContext?: { itemId?: string; calendarDate?: string } }): Promise<BeginConversationTurn> {
    const input = this.identity(identity);
    exactObject(request, ["userRequest", "requestedResearchMode", "researchTarget", "tripId", "uiContext"]);
    if (typeof request.userRequest !== "string" || !request.userRequest.trim() || request.userRequest.length > 8_000) throw new StateError("invalid-input");
    const [message] = messageInputs([{ role: "user", text: request.userRequest }]);
    if (request.tripId !== undefined) stateId(request.tripId);
    if (request.requestedResearchMode !== undefined && !["standard", "detailed"].includes(request.requestedResearchMode)) throw new StateError("invalid-input");
    if (request.uiContext !== undefined) exactObject(request.uiContext, ["itemId", "calendarDate"]);
    const itemId = request.uiContext?.itemId;
    if (itemId !== undefined && (typeof itemId !== "string" || !itemId.trim() || itemId.length > 200 || /[\u0000-\u001f\u007f]/u.test(itemId))) throw new StateError("invalid-input");
    const calendarDate = request.uiContext?.calendarDate;
    if (calendarDate !== undefined && !validCalendarDate(calendarDate)) throw new StateError("invalid-input");
    const requestHash = createHash("sha256").update(JSON.stringify([request.userRequest, request.requestedResearchMode ?? "standard", request.researchTarget ?? null, request.tripId ?? null, itemId ?? null, calendarDate ?? null])).digest("hex");
    const { current, old, turn } = await this.read(input);
    if ((await this.getWorkingState(input.principal, input.conversationId))?.semantic?.adoptionInFlight) throw new StateError("conflict");
    if (turn && turn.requestHash !== requestHash) throw new StateError("conflict");
    if (turn?.state === "completed") return { state: "completed", result: turn.result! };
    const now = this.now(current.updatedAt), time = Date.parse(now);
    if ((turn?.state === "started" || turn?.state === "intent_accepted") && turn.leaseUntil > time) throw new StateError("conflict");
    // Retain receipts for the entire conversation lifetime; never silently forget an old ID.
    if (!turn && current.messageCount >= conversationTurnLimits.newTurnMessageLimit) throw new StateError("conflict");
    const attemptId = this.newAttemptId(); stateId(attemptId);
    const next: TurnRecord = { requestHash, state: turn?.intentReceipt ? "intent_accepted" : "started", attemptId, leaseUntil: time + conversationTurnLimits.leaseMs,
      userSequence: turn?.userSequence ?? current.messageCount + 1,
      ...(calendarDate ? { baseCalendarDate: calendarDate } : {}), ...(request.tripId ? { targetTripId: request.tripId } : {}),
      ...(turn?.intentReceipt ? { intentReceipt: turn.intentReceipt } : {}) };
    await this.write(input.principal, current, { ...current, revision: current.revision + 1, updatedAt: now,
      messageCount: current.messageCount + (turn ? 0 : 1) },
    turn ? [] : [{ ...message, sequence: next.userSequence, createdAt: now }],
    [this.store.put(input.principal, this.key(input), { revision: (old?.revision ?? -1) + 1, deleted: false, payload: next }, old)]);
    return next.intentReceipt ? { state: "intent_accepted", lease: { attemptId, userSequence: next.userSequence }, receipt: next.intentReceipt } :
      { state: "started", lease: { attemptId, userSequence: next.userSequence } };
  }

  async acceptIntent(identity: ConversationTurnIdentity, lease: ConversationTurnLease, candidate: AcceptedIntentDelta): Promise<IntentApplicationReceipt> {
    const input = this.identity(identity), delta = parseAcceptedIntentDelta(candidate);
    exactObject(lease, ["attemptId", "userSequence"]); stateId(lease.attemptId);
    const { current, old, turn } = await this.read(input);
    if (!turn || turn.attemptId !== lease.attemptId || turn.userSequence !== lease.userSequence) throw new StateError("conflict");
    if (turn.intentReceipt) {
      if (turn.intentReceipt.mutationId !== delta.mutationId) throw new StateError("conflict");
      return turn.intentReceipt;
    }
    const now = this.now(current.updatedAt);
    if (turn.state !== "started" || turn.leaseUntil <= Date.parse(now)) throw new StateError("conflict");
    const workingKey = this.workingKey(input.conversationId), oldWorking = await this.store.read(input.principal, workingKey);
    const previousWorking = oldWorking ? parseConversationWorkingState(oldWorking.payload) : undefined;
    const semantic = semanticStateOf(previousWorking);
    if (semantic.adoptionInFlight) throw new StateError("conflict");
    let reduction;
    try { reduction = reduceConversationIntent(semantic.overlay, delta); }
    catch { throw new StateError("conflict"); }
    const working = parseConversationWorkingState({
      version: 2, revision: (oldWorking?.revision ?? -1) + 1,
      sourceTurnId: input.turnId, sourceUserSequence: turn.userSequence,
      target: previousWorking?.target ?? { conversationId: input.conversationId, ...(turn.targetTripId ? { tripId: turn.targetTripId } : {}) },
      presentations: previousWorking?.presentations ?? [], pendingQuestionRefs: previousWorking?.pendingQuestionRefs ?? [],
      pendingProposalRefs: previousWorking?.pendingProposalRefs ?? [], ...(previousWorking?.groundingEvidence?.length ? { groundingEvidence: previousWorking.groundingEvidence } : {}),
      ...(previousWorking?.lastOutcome ? { lastOutcome: previousWorking.lastOutcome } : {}),
      semantic: { ...semantic, overlay: reduction.overlay, receipts: [...semantic.receipts, reduction.receipt].slice(-20) },
    });
    const next: TurnRecord = { ...turn, state: "intent_accepted", intentReceipt: reduction.receipt };
    await this.write(input.principal, current, { ...current, updatedAt: now, revision: current.revision + 1 }, [], [
      this.store.put(input.principal, this.key(input), { revision: old!.revision + 1, deleted: false, payload: next }, old),
      this.store.put(input.principal, workingKey, { revision: working.revision, deleted: false, payload: working }, oldWorking),
    ]);
    return reduction.receipt;
  }
  private async finish(identity: ConversationTurnIdentity, lease: ConversationTurnLease, result?: ConversationTurnResult, continuity?: ConversationTurnContinuity) {
    const input = this.identity(identity);
    exactObject(lease, ["attemptId", "userSequence"]); stateId(lease.attemptId);
    const attemptId = lease.attemptId, userSequence = lease.userSequence;
    const saved = result === undefined ? undefined : finalResult(result);
    if (saved?.consultationRequestProposal && saved.consultationRequestProposal.conversationId !== input.conversationId) throw new StateError("invalid-input");
    const { current, old, turn } = await this.read(input);
    if (!turn || turn.attemptId !== attemptId || turn.userSequence !== userSequence) throw new StateError("conflict");
    if (turn.state === "completed") {
      if (!saved || saved.status !== turn.result!.status || saved.response !== turn.result!.response || JSON.stringify(saved.delivery) !== JSON.stringify(turn.result!.delivery) || JSON.stringify(saved.semanticReceipt) !== JSON.stringify(turn.result!.semanticReceipt) || JSON.stringify(saved.publicPlanPresentation) !== JSON.stringify(turn.result!.publicPlanPresentation) || JSON.stringify(saved.publicJourneyPresentation) !== JSON.stringify(turn.result!.publicJourneyPresentation) || JSON.stringify(saved.publicPlacePresentation) !== JSON.stringify(turn.result!.publicPlacePresentation) || JSON.stringify(saved.researchExecution) !== JSON.stringify(turn.result!.researchExecution) || JSON.stringify(saved.tripUpdateProposal) !== JSON.stringify(turn.result!.tripUpdateProposal) || JSON.stringify(saved.consultationRequestProposal) !== JSON.stringify(turn.result!.consultationRequestProposal) || JSON.stringify(saved.tripCostProposal) !== JSON.stringify(turn.result!.tripCostProposal)) throw new StateError("conflict");
      return turn.result;
    }
    if (!saved && turn.state === "failed") return;
    const now = this.now(current.updatedAt);
    if (!["started", "intent_accepted"].includes(turn.state) || turn.leaseUntil <= Date.parse(now)) throw new StateError("conflict");
    if (saved && current.messageCount >= 999_999_999_999) throw new StateError("conflict");
    const next: TurnRecord = { ...turn, state: saved ? "completed" : "failed", ...(saved ? { result: saved } : {}) };
    const workingKey = this.workingKey(input.conversationId);
    const oldWorking = saved ? await this.store.read(input.principal, workingKey) : undefined;
    const previousWorking = oldWorking ? parseConversationWorkingState(oldWorking.payload) : undefined;
    const savedTargetTripId = saved?.tripUpdateProposal?.tripId ?? saved?.tripCostProposal?.tripId ?? turn.targetTripId;
    const targetTripRevision = saved?.publicPlanPresentation?.target?.baseTripRevision ?? saved?.tripUpdateProposal?.baseRevision ?? saved?.tripCostProposal?.baseRevision ??
      (previousWorking && previousWorking.target.tripId === turn.targetTripId ? previousWorking.target.tripRevision : undefined);
    const groundingEvidence = saved ? retainConversationEvidence(previousWorking?.groundingEvidence,
      continuity?.evidence ?? [], continuity?.publishedEvidenceIds ?? []) : [];
    const semantic = semanticStateOf(previousWorking);
    const working = saved ? parseConversationWorkingState({
      version: 2, revision: (oldWorking?.revision ?? -1) + 1,
      sourceTurnId: input.turnId, sourceUserSequence: turn.userSequence,
      target: { conversationId: input.conversationId, ...(savedTargetTripId ? { tripId: savedTargetTripId,
        ...(targetTripRevision === undefined ? {} : { tripRevision: targetTripRevision }) } : {}) },
      presentations: [...(previousWorking?.presentations ?? []), ...(saved.presentationReceipt ? [saved.presentationReceipt] : [])].slice(-20),
      pendingQuestionRefs: saved.turnObservation?.outcome === "ask_only" || saved.turnObservation?.outcome === "ask_and_progress"
        ? saved.turnObservation.exception ? [saved.turnObservation.exception.missingFact] : [] : [],
      pendingProposalRefs: [saved.tripUpdateProposal ? "trip_update" : "", saved.consultationRequestProposal ? "consultation_update" : "", saved.tripCostProposal ? "cost_update" : ""].filter(Boolean),
      ...(groundingEvidence.length ? { groundingEvidence } : {}),
      ...(saved.turnObservation ? { lastOutcome: saved.turnObservation } : {}),
      semantic: saved.tripUpdateProposal?.intentBinding ? { ...semantic, pendingProposal: { binding: saved.tripUpdateProposal.intentBinding,
        tripId: saved.tripUpdateProposal.tripId, baseTripRevision: saved.tripUpdateProposal.baseRevision } } : semantic,
    }) : undefined;
    await this.write(input.principal, current, { ...current, updatedAt: now, revision: current.revision + 1,
      messageCount: current.messageCount + (saved ? 1 : 0) },
    saved ? [{ role: "assistant", text: saved.response, ...(saved.delivery ? { delivery: saved.delivery } : {}), ...(saved.semanticReceipt ? { semanticReceipt: saved.semanticReceipt } : {}), ...(saved.publicPlanPresentation ? { publicPlanPresentation: saved.publicPlanPresentation } : {}), ...(saved.publicJourneyPresentation ? { publicJourneyPresentation: saved.publicJourneyPresentation } : {}), ...(saved.publicPlacePresentation ? { publicPlacePresentation: saved.publicPlacePresentation } : {}), ...(saved.tripCostProposal ? { tripCostProposal: saved.tripCostProposal } : {}), ...(saved.tripUpdateProposal ? { tripUpdateProposal: saved.tripUpdateProposal } : {}), ...(saved.consultationRequestProposal ? { consultationRequestProposal: saved.consultationRequestProposal } : {}), sequence: current.messageCount + 1, createdAt: now }] : [],
    [this.store.put(input.principal, this.key(input), { revision: old!.revision + 1, deleted: false, payload: next }, old),
      ...(working ? [this.store.put(input.principal, workingKey, { revision: working.revision, deleted: false, payload: working }, oldWorking)] : [])]);
    return saved;
  }
  async completeTurn(identity: ConversationTurnIdentity, lease: ConversationTurnLease, result: ConversationTurnResult, continuity?: ConversationTurnContinuity) {
    return (await this.finish(identity, lease, result, continuity))!;
  }
  async failTurn(identity: ConversationTurnIdentity, lease: ConversationTurnLease) { await this.finish(identity, lease); }
}

function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function parseDelivery(value: unknown): NonNullable<ConversationTurnResult["delivery"]> {
  exactObject(value, ["status", "basis"]);
  if (!["full", "partial", "degraded"].includes(String(value.status)) || !["model", "verified_projection"].includes(String(value.basis))) throw new StateError("invalid-input");
  return { status: value.status as NonNullable<ConversationTurnResult["delivery"]>["status"], basis: value.basis as NonNullable<ConversationTurnResult["delivery"]>["basis"] };
}
function receiptMatches(receipts: readonly IntentApplicationReceipt[], binding: IntentProposalBinding): boolean {
  const receipt = receipts.find(({ intentRevision }) => intentRevision === binding.intentRevision);
  if (!receipt) return false;
  return binding.changes.every((change) => receipt.operations.some((operation) => operation.status === "accepted" && operation.operationId === change.changeRef &&
    operation.groupId === change.groupRef && operation.action === change.action && operation.target === change.target && JSON.stringify(operation.scope) === JSON.stringify(change.scope)));
}
function sameAdoption(left: { binding: IntentProposalBinding; tripId: string; baseTripRevision: number; mutationId: string },
  right: { binding: IntentProposalBinding; tripId: string; baseTripRevision: number; mutationId: string }): boolean {
  return left.tripId === right.tripId && left.baseTripRevision === right.baseTripRevision && left.mutationId === right.mutationId &&
    JSON.stringify(left.binding) === JSON.stringify(right.binding);
}
