import { parsePublicCostProposal } from "@raiquora/trip/public-cost-proposal";
import { parseConsultationRequestProposal } from "@raiquora/trip/consultation-request-proposal";
import { parsePublicRequestProposal } from "@raiquora/trip/public-request-proposal";
import { createHash, randomUUID } from "node:crypto";
import { StateError, exactObject, messageInputs, stateId, type StateClock } from "../contracts/server-state.js";
import type { BeginConversationTurn, ConversationTurnIdentity, ConversationTurnLease, ConversationTurnRepository, ConversationTurnResult } from "../ports/conversation-turn-repository.js";
import { DynamoDbConversationRepository } from "./dynamodb-conversation-repository.js";
import type { StateDynamoClient, StateEnvelope } from "./dynamodb-state-store.js";

export const conversationTurnLimits = { leaseMs: 300_000, newTurnMessageLimit: 2_000 } as const;
interface TurnRecord {
  requestHash: string;
  state: "started" | "failed" | "completed";
  attemptId: string;
  leaseUntil: number;
  userSequence: number;
  result?: ConversationTurnResult;
}
function finalResult(value: ConversationTurnResult): ConversationTurnResult {
  exactObject(value, ["status", "response", "tripUpdateProposal", "consultationRequestProposal", "tripCostProposal"]);
  if (value.status !== "completed" && value.status !== "follow_up") throw new StateError("invalid-input");
  messageInputs([{ role: "assistant", text: value.response }]);
  try {
    if ((value.tripUpdateProposal || value.tripCostProposal) && value.consultationRequestProposal) throw new Error();
    return { status: value.status, response: value.response, ...(value.tripCostProposal !== undefined ? { tripCostProposal: parsePublicCostProposal(value.tripCostProposal) } : {}), ...(value.tripUpdateProposal !== undefined ? { tripUpdateProposal: parsePublicRequestProposal(value.tripUpdateProposal) } : {}), ...(value.consultationRequestProposal !== undefined ? { consultationRequestProposal: parseConsultationRequestProposal(value.consultationRequestProposal) } : {}) };
  } catch { throw new StateError("invalid-input"); }
}

/** Conversation CAS fences delete and every turn transition; no separate table or expiring receipts. */
export class DynamoDbConversationTurnRepository extends DynamoDbConversationRepository implements ConversationTurnRepository {
  constructor(table: string, client?: StateDynamoClient, clock?: StateClock, private readonly newAttemptId = randomUUID) {
    super(table, client, clock);
  }
  private identity(input: ConversationTurnIdentity) {
    this.store.owner(input.principal); stateId(input.conversationId); stateId(input.turnId);
    return structuredClone(input);
  }
  private key(input: ConversationTurnIdentity) { return `TURN#${input.conversationId}#${input.turnId}`; }
  private decodeTurn(envelope: StateEnvelope): TurnRecord {
    try {
      const value = envelope.payload;
      exactObject(value, ["requestHash", "state", "attemptId", "leaseUntil", "userSequence", "result"]);
      if (envelope.deleted || typeof value.requestHash !== "string" || !/^[0-9a-f]{64}$/.test(value.requestHash) ||
        typeof value.state !== "string" || !["started", "failed", "completed"].includes(value.state) ||
        !Number.isSafeInteger(value.leaseUntil) || Number(value.leaseUntil) < 0 ||
        !Number.isSafeInteger(value.userSequence) || Number(value.userSequence) < 1) throw new Error();
      stateId(value.attemptId);
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
  async beginTurn(identity: ConversationTurnIdentity, request: { userRequest: string; tripId?: string; uiContext?: { itemId?: string; calendarDate?: string } }): Promise<BeginConversationTurn> {
    const input = this.identity(identity);
    exactObject(request, ["userRequest", "tripId", "uiContext"]);
    if (typeof request.userRequest !== "string" || !request.userRequest.trim() || request.userRequest.length > 8_000) throw new StateError("invalid-input");
    const [message] = messageInputs([{ role: "user", text: request.userRequest }]);
    if (request.tripId !== undefined) stateId(request.tripId);
    if (request.uiContext !== undefined) exactObject(request.uiContext, ["itemId", "calendarDate"]);
    const itemId = request.uiContext?.itemId;
    if (itemId !== undefined && (typeof itemId !== "string" || !itemId.trim() || itemId.length > 200 || /[\u0000-\u001f\u007f]/u.test(itemId))) throw new StateError("invalid-input");
    const calendarDate = request.uiContext?.calendarDate;
    if (calendarDate !== undefined && !validCalendarDate(calendarDate)) throw new StateError("invalid-input");
    const requestHash = createHash("sha256").update(JSON.stringify([request.userRequest, request.tripId ?? null, itemId ?? null])).digest("hex");
    const { current, old, turn } = await this.read(input);
    if (turn && turn.requestHash !== requestHash) throw new StateError("conflict");
    if (turn?.state === "completed") return { state: "completed", result: turn.result! };
    const now = this.now(current.updatedAt), time = Date.parse(now);
    if (turn?.state === "started" && turn.leaseUntil > time) throw new StateError("conflict");
    // Retain receipts for the entire conversation lifetime; never silently forget an old ID.
    if (!turn && current.messageCount >= conversationTurnLimits.newTurnMessageLimit) throw new StateError("conflict");
    const attemptId = this.newAttemptId(); stateId(attemptId);
    const next: TurnRecord = { requestHash, state: "started", attemptId, leaseUntil: time + conversationTurnLimits.leaseMs,
      userSequence: turn?.userSequence ?? current.messageCount + 1 };
    await this.write(input.principal, current, { ...current, revision: current.revision + 1, updatedAt: now,
      messageCount: current.messageCount + (turn ? 0 : 1) },
    turn ? [] : [{ ...message, sequence: next.userSequence, createdAt: now }],
    [this.store.put(input.principal, this.key(input), { revision: (old?.revision ?? -1) + 1, deleted: false, payload: next }, old)]);
    return { state: "started", lease: { attemptId, userSequence: next.userSequence } };
  }
  private async finish(identity: ConversationTurnIdentity, lease: ConversationTurnLease, result?: ConversationTurnResult) {
    const input = this.identity(identity);
    exactObject(lease, ["attemptId", "userSequence"]); stateId(lease.attemptId);
    const attemptId = lease.attemptId, userSequence = lease.userSequence;
    const saved = result === undefined ? undefined : finalResult(result);
    if (saved?.consultationRequestProposal && saved.consultationRequestProposal.conversationId !== input.conversationId) throw new StateError("invalid-input");
    const { current, old, turn } = await this.read(input);
    if (!turn || turn.attemptId !== attemptId || turn.userSequence !== userSequence) throw new StateError("conflict");
    if (turn.state === "completed") {
      if (!saved || saved.status !== turn.result!.status || saved.response !== turn.result!.response || JSON.stringify(saved.tripUpdateProposal) !== JSON.stringify(turn.result!.tripUpdateProposal) || JSON.stringify(saved.consultationRequestProposal) !== JSON.stringify(turn.result!.consultationRequestProposal) || JSON.stringify(saved.tripCostProposal) !== JSON.stringify(turn.result!.tripCostProposal)) throw new StateError("conflict");
      return turn.result;
    }
    if (!saved && turn.state === "failed") return;
    const now = this.now(current.updatedAt);
    if (turn.state !== "started" || turn.leaseUntil <= Date.parse(now)) throw new StateError("conflict");
    if (saved && current.messageCount >= 999_999_999_999) throw new StateError("conflict");
    const next: TurnRecord = { ...turn, state: saved ? "completed" : "failed", ...(saved ? { result: saved } : {}) };
    await this.write(input.principal, current, { ...current, updatedAt: now, revision: current.revision + 1,
      messageCount: current.messageCount + (saved ? 1 : 0) },
    saved ? [{ role: "assistant", text: saved.response, ...(saved.tripCostProposal ? { tripCostProposal: saved.tripCostProposal } : {}), ...(saved.tripUpdateProposal ? { tripUpdateProposal: saved.tripUpdateProposal } : {}), ...(saved.consultationRequestProposal ? { consultationRequestProposal: saved.consultationRequestProposal } : {}), sequence: current.messageCount + 1, createdAt: now }] : [],
    [this.store.put(input.principal, this.key(input), { revision: old!.revision + 1, deleted: false, payload: next }, old)]);
    return saved;
  }
  async completeTurn(identity: ConversationTurnIdentity, lease: ConversationTurnLease, result: ConversationTurnResult) {
    return (await this.finish(identity, lease, result))!;
  }
  async failTurn(identity: ConversationTurnIdentity, lease: ConversationTurnLease) { await this.finish(identity, lease); }
}

function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
