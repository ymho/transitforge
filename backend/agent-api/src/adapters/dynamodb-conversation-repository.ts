import { parsePublicCostProposal } from "@raiquora/trip/public-cost-proposal";
import { parseConsultationRequestProposal } from "@raiquora/trip/consultation-request-proposal";
import { parsePublicRequestProposal } from "@raiquora/trip/public-request-proposal";
import { parsePublicPlanPresentation } from "@raiquora/agent/public-plan-presentation";
import { parsePublicJourneyPresentation } from "@raiquora/agent/public-journey-presentation";
import { parsePublicSemanticReceipt } from "@raiquora/agent/public-semantic-receipt";
import { PutItemCommand, TransactWriteItemsCommand, type Put } from "@aws-sdk/client-dynamodb";
import type { TrustedPrincipal } from "../contracts/trusted-principal.js";
import { StateError, exactObject, metadata, messageInputs, pageOptions, revision, stateId,
  type Conversation, type ConversationMetadata, type ConversationMessage, type MessageInput, type PageOptions, type StateClock } from "../contracts/server-state.js";
import type { ConversationRepository } from "../ports/conversation-repository.js";
import { DynamoStateStore, type StateDynamoClient, type StateEnvelope } from "./dynamodb-state-store.js";

const conversationKey = (id: string) => { stateId(id); return `CONVERSATION#${id}`; };
const messagePrefix = (id: string) => { stateId(id); return `MESSAGE#${id}#`; };
const sequenceKey = (sequence: number) => String(sequence).padStart(12, "0");
function sequence(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 999_999_999_999) throw new StateError("invalid-input");
}
function timestamp(value: unknown): asserts value is string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error();
}
export class DynamoDbConversationRepository implements ConversationRepository {
  protected readonly store: DynamoStateStore;
  constructor(table: string, client?: StateDynamoClient, protected readonly clock: StateClock = { now: () => new Date() }) {
    this.store = new DynamoStateStore(table, client);
  }
  private decode(principal: TrustedPrincipal, id: string, envelope: StateEnvelope): Conversation | undefined {
    if (envelope.deleted) return undefined;
    try {
      const value = envelope.payload;
      exactObject(value, ["conversationId", "ownerSubject", "createdAt", "updatedAt", "revision", "messageCount", "title", "scope", "summary", "resolvedTopics", "pendingTopics", "tripId", "draftRequest"]);
      const { conversationId, ownerSubject, createdAt, updatedAt, revision: version, messageCount, ...fields } = value;
      if (conversationId !== id || ownerSubject !== principal.subject || version !== envelope.revision) throw new Error();
      timestamp(createdAt); timestamp(updatedAt); sequence(messageCount);
      if (Date.parse(updatedAt) < Date.parse(createdAt)) throw new Error();
      return { ...metadata(fields), conversationId: id, ownerSubject, createdAt, updatedAt, revision: envelope.revision, messageCount };
    } catch { throw new StateError("unavailable"); }
  }
  protected now(previous?: string) {
    const now = this.clock.now().toISOString();
    if (previous && now < previous) throw new StateError("unavailable");
    return now;
  }
  async create(principal: TrustedPrincipal, id: string, input: ConversationMetadata): Promise<Conversation> {
    this.store.owner(principal);
    const sk = conversationKey(id), fields = metadata(input), now = this.now();
    const conversation: Conversation = { ...fields, conversationId: id, ownerSubject: principal.subject, createdAt: now, updatedAt: now, revision: 0, messageCount: 0 };
    await this.store.send(new PutItemCommand(this.store.put(principal, sk, { revision: 0, deleted: false, payload: conversation })));
    return conversation;
  }
  async get(principal: TrustedPrincipal, id: string) {
    this.store.owner(principal);
    const envelope = await this.store.read(principal, conversationKey(id));
    return envelope ? this.decode(principal, id, envelope) : undefined;
  }
  async list(principal: TrustedPrincipal, options: PageOptions = {}) {
    this.store.owner(principal);
    const { limit, after } = pageOptions(options);
    if (after !== undefined) stateId(after);
    const result = await this.store.query(principal, "CONVERSATION#", limit, after ? conversationKey(after) : undefined);
    const items = result.items.flatMap((item) => {
      const id = item.sk.S!.slice("CONVERSATION#".length);
      try { stateId(id); } catch { throw new StateError("unavailable"); }
      const value = this.decode(principal, id, this.store.decode(item, this.store.owner(principal), conversationKey(id)));
      return value ? [value] : [];
    });
    const nextAfter = result.next?.slice("CONVERSATION#".length);
    if (nextAfter) { try { stateId(nextAfter); } catch { throw new StateError("unavailable"); } }
    return { items, ...(nextAfter ? { nextAfter } : {}) };
  }
  async history(principal: TrustedPrincipal, id: string, options: PageOptions = {}) {
    this.store.owner(principal);
    const { limit, after } = pageOptions(options), prefix = messagePrefix(id);
    if (after !== undefined && !/^\d{12}$/.test(after)) throw new StateError("invalid-input");
    const current = await this.get(principal, id);
    if (!current) throw new StateError("not-found");
    if (after !== undefined && Number(after) > current.messageCount) throw new StateError("invalid-input");
    const result = await this.store.query(principal, prefix, limit, after ? `${prefix}${after}` : undefined, `${prefix}${sequenceKey(current.messageCount)}`);
    const items = result.items.map((item): ConversationMessage => {
      try {
        const value: unknown = JSON.parse(item.payload?.S ?? "");
        exactObject(value, ["sequence", "createdAt", "role", "text", "delivery", "semanticReceipt", "publicPlanPresentation", "publicJourneyPresentation", "tripUpdateProposal", "consultationRequestProposal", "tripCostProposal"]);
        sequence(value.sequence); timestamp(value.createdAt);
        if (value.sequence < 1 || item.sk.S !== `${prefix}${sequenceKey(value.sequence)}` || item.storageVersion?.N !== "1") throw new Error();
        const [message] = messageInputs([{ role: value.role, text: value.text }]);
        if ((value.delivery !== undefined || value.semanticReceipt !== undefined || value.publicPlanPresentation !== undefined || value.publicJourneyPresentation !== undefined || value.tripUpdateProposal !== undefined || value.consultationRequestProposal !== undefined || value.tripCostProposal !== undefined) && message.role !== "assistant") throw new Error();
        if ((value.tripUpdateProposal || value.tripCostProposal) && value.consultationRequestProposal) throw new Error();
        const consultationRequestProposal = value.consultationRequestProposal === undefined ? undefined : parseConsultationRequestProposal(value.consultationRequestProposal);
        if (consultationRequestProposal && consultationRequestProposal.conversationId !== id) throw new Error();
        const delivery = value.delivery === undefined ? undefined : deliveryStatus(value.delivery);
        return { ...message, sequence: value.sequence, createdAt: value.createdAt, ...(delivery ? { delivery } : {}), ...(value.semanticReceipt !== undefined ? { semanticReceipt: parsePublicSemanticReceipt(value.semanticReceipt) } : {}), ...(value.publicPlanPresentation !== undefined ? { publicPlanPresentation: parsePublicPlanPresentation(value.publicPlanPresentation) } : {}), ...(value.publicJourneyPresentation !== undefined ? { publicJourneyPresentation: parsePublicJourneyPresentation(value.publicJourneyPresentation) } : {}), ...(value.tripCostProposal !== undefined ? { tripCostProposal: parsePublicCostProposal(value.tripCostProposal) } : {}),
          ...(value.tripUpdateProposal !== undefined ? { tripUpdateProposal: parsePublicRequestProposal(value.tripUpdateProposal) } : {}), ...(consultationRequestProposal ? { consultationRequestProposal } : {}) };
      } catch { throw new StateError("unavailable"); }
    });
    // Do not return content read concurrently with delete/update. Pages are not a global snapshot.
    const latest = await this.get(principal, id);
    if (!latest) throw new StateError("not-found");
    if (latest.revision !== current.revision) throw new StateError("conflict");
    const nextAfter = result.next?.slice(prefix.length);
    if (nextAfter && !/^\d{12}$/.test(nextAfter)) throw new StateError("unavailable");
    return { items, ...(nextAfter ? { nextAfter } : {}) };
  }
  private async current(principal: TrustedPrincipal, id: string, expected: number) {
    this.store.owner(principal); revision(expected);
    const current = await this.get(principal, id);
    if (!current) throw new StateError("not-found");
    if (current.revision !== expected) throw new StateError("conflict");
    return current;
  }
  protected async write(principal: TrustedPrincipal, current: Conversation, next: Conversation, messages: ConversationMessage[] = [], additionalPuts: Put[] = []) {
    const put = this.store.put(principal, conversationKey(current.conversationId), { revision: next.revision, deleted: false, payload: next }, { revision: current.revision, deleted: false });
    try {
      await this.store.send(new TransactWriteItemsCommand({ TransactItems: [{ Put: put }, ...additionalPuts.map((Put) => ({ Put })), ...messages.map((message) => ({ Put: {
        TableName: this.store.table, Item: { ...this.store.key(principal, `${messagePrefix(current.conversationId)}${sequenceKey(message.sequence)}`),
          storageVersion: { N: "1" }, payload: { S: JSON.stringify(message) } }, ConditionExpression: "attribute_not_exists(pk)",
      } }))] }));
    } catch (error) {
      if (error instanceof StateError && error.code === "conflict" && !await this.get(principal, current.conversationId)) throw new StateError("not-found");
      throw error;
    }
    return next;
  }
  async append(principal: TrustedPrincipal, id: string, expected: number, input: MessageInput[]) {
    this.store.owner(principal);
    const messages = messageInputs(input), current = await this.current(principal, id, expected), now = this.now(current.updatedAt);
    sequence(current.messageCount + messages.length);
    return this.write(principal, current, { ...current, updatedAt: now, revision: expected + 1, messageCount: current.messageCount + messages.length },
      messages.map((message, index) => ({ ...message, sequence: current.messageCount + index + 1, createdAt: now })));
  }
  async update(principal: TrustedPrincipal, id: string, expected: number, input: ConversationMetadata) {
    this.store.owner(principal);
    const fields = metadata(input), current = await this.current(principal, id, expected);
    // Whole metadata replacement deliberately allows tripId to be detached by omission.
    const { tripId: _tripId, draftRequest: _draftRequest, ...previous } = current;
    return this.write(principal, current, { ...previous, ...fields, updatedAt: this.now(current.updatedAt), revision: expected + 1 });
  }
  async delete(principal: TrustedPrincipal, id: string, expected: number) {
    this.store.owner(principal); revision(expected);
    const sk = conversationKey(id), old = await this.store.read(principal, sk);
    if (!old) throw new StateError("not-found");
    // Tombstone keeps the incremented revision; callers retry with the same deletion base.
    if (old.deleted ? old.revision !== expected + 1 : old.revision !== expected) throw new StateError(old.deleted ? "not-found" : "conflict");
    if (!old.deleted) {
      this.decode(principal, id, old);
      await this.store.send(new PutItemCommand(this.store.put(principal, sk, { revision: expected + 1, deleted: true }, old)));
    }
    // Every conversation-derived resource is owner scoped and begins with one of these
    // prefixes. Purge one bounded page per kind; a retry resumes from the tombstone.
    // Trip/Profile/Reservation are independent resources and deliberately stay intact.
    for (const prefix of [messagePrefix(id), `TURN#${id}#`, `WORKING#${id}`]) {
      const page = await this.store.query(principal, prefix, 50);
      await this.store.purge(principal, page.items.map((item) => item.sk.S!));
      if (page.next !== undefined) return { complete: false };
    }
    return { complete: true };
  }
}
function deliveryStatus(value: unknown): NonNullable<ConversationMessage["delivery"]> {
  exactObject(value, ["status", "basis"]);
  if (!["full", "partial", "degraded"].includes(String(value.status)) || !["model", "verified_projection"].includes(String(value.basis))) throw new Error();
  return { status: value.status as NonNullable<ConversationMessage["delivery"]>["status"], basis: value.basis as NonNullable<ConversationMessage["delivery"]>["basis"] };
}
