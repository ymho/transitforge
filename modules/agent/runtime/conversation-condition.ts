import { z } from "zod";
import { parseAcceptedIntentDelta, type AcceptedIntentDelta, type ConversationIntentOverlay, type IntentValue } from "@raiquora/trip/conversation-intent";
import { validateTripParty } from "@raiquora/trip/trip-party";
import { parseIntentApplicationReceipt, type IntentApplicationReceipt } from "./conversation-intent-reducer";

/** Set and clear are distinct business commands. Omitted/unknown values must never
 * be confused with retraction. Places are user labels, not geocoded facts. */
const sourceQuote = z.string().min(1).max(300).describe("この操作を求めるuserMessageの完全な部分文字列。");
const placeLabel = z.string().min(1).max(200).regex(/^(?!\s)(?![\s\S]*\s$)[^\u0000-\u001f\u007f<>]+$/u)
  .describe("今回の発言からそのまま取り出した地名。");
export const placeConditionInputSchema = z.strictObject({ place: placeLabel, quote: sourceQuote });
export const clearConditionInputSchema = z.strictObject({ quote: sourceQuote });

const partyCount = z.strictObject({
  kind: z.literal("count"),
  people: z.number().int().min(1).max(20).describe("明示された合計人数。大人/子どもの内訳は推測しない。"),
});
const partyComposition = z.strictObject({
  kind: z.literal("composition"),
  adults: z.number().int().min(0).max(20),
  children: z.number().int().min(0).max(20).describe("明示された子どもの人数。年齢・年代・関係性はこのToolでは扱わない。"),
}).refine((value) => value.adults + value.children >= 1 && value.adults + value.children <= 20, {
  message: "同行者は1〜20人にする",
});
export const partyConditionValueSchema = z.union([partyCount, partyComposition]);
export const partyConditionInputSchema = z.strictObject({
  party: partyConditionValueSchema.describe("今回の同行者。合計だけならcount、明示された大人/子どもの人数がある時だけcomposition。年齢・年代・関係性は推測しない。"),
  quote: sourceQuote,
});

export const conditionTargets = ["origin", "destination", "party_size"] as const;
const placeChangeSchema = z.strictObject({ target: z.enum(["origin", "destination"]), place: placeLabel.nullable(), quote: sourceQuote });
const partyChangeSchema = z.strictObject({ target: z.literal("party_size"), party: partyConditionValueSchema.nullable(), quote: sourceQuote });
/** Internal command only. Tools cannot choose identity, scope or revision. */
export const conversationConditionSchema = z.union([placeChangeSchema, partyChangeSchema]);
export type PlaceConditionInput = z.infer<typeof placeConditionInputSchema>;
export type PartyConditionInput = z.infer<typeof partyConditionInputSchema>;
export type ConversationConditionChange = z.infer<typeof conversationConditionSchema>;
export type ConditionTarget = ConversationConditionChange["target"];

export class ConditionUpdateRejectedError extends Error {
  constructor(readonly code: "invalid_condition" | "invalid_source" | "condition_conflict") {
    super(code); this.name = "ConditionUpdateRejectedError";
  }
}

/** Syntax is shared with the SDK. Source checking is Application admission, not
 * a regex-based language interpreter. Questions/hypotheses must not call the writer. */
export function admitConditionChange(value: unknown, userMessage: string): ConversationConditionChange {
  const parsed = conversationConditionSchema.safeParse(value);
  if (!parsed.success) throw new ConditionUpdateRejectedError("invalid_condition");
  const change = parsed.data;
  if (!userMessage.includes(change.quote)) throw new ConditionUpdateRejectedError("invalid_source");
  if ("place" in change && change.place !== null && !change.quote.includes(change.place))
    throw new ConditionUpdateRejectedError("invalid_source");
  if ("party" in change && change.party?.kind === "composition") {
    try {
      validateTripParty({ adults: change.party.adults, children: Array.from({ length: change.party.children }, () => ({})), source: "user" });
    } catch { throw new ConditionUpdateRejectedError("invalid_condition"); }
  }
  return change;
}

/** Application-issued identity: one final decision per condition per user message.
 * SDK toolUseId, invocation attempt and call order do not identify business commands.
 * A different decision for the same slot conflicts; a later user turn gets a new slot. */
export function conditionOperationId(turnId: string, target: ConditionTarget): string {
  return `condition:${turnId}:${target}`;
}
export function conditionPayload(change: ConversationConditionChange): string {
  // Exact, already-validated quote may differ on a replay; the requested state must not.
  if ("place" in change) return JSON.stringify([1, change.target, change.place]);
  if (change.party === null || change.party.kind === "count") return JSON.stringify([1, change.target, change.party]);
  return JSON.stringify([1, change.target, change.party]);
}

/** Adapt a validated business operation directly to the existing pure reducer.
 * No UtteranceInterpretation, legacy decoder, model call, clock or Provider is involved. */
export function conditionDelta(change: ConversationConditionChange, turnId: string, overlay: ConversationIntentOverlay): AcceptedIntentDelta {
  const operationId = conditionOperationId(turnId, change.target);
  const cleared = "place" in change ? change.place === null : change.party === null;
  let value: IntentValue | undefined;
  if (!cleared && "place" in change) value = { kind: "place_label", label: change.place! };
  if (!cleared && "party" in change && change.party?.kind === "count")
    value = { kind: "quantity", amount: change.party.people, unit: "people" };
  if (!cleared && "party" in change && change.party?.kind === "composition")
    value = { kind: "party", adults: change.party.adults, children: Array.from({ length: change.party.children }, () => ({})) };
  return parseAcceptedIntentDelta({ version: 1, mutationId: operationId, baseIntentRevision: overlay.intentRevision,
    speechAct: cleared ? "cancel" : "inform", operations: [{
      operationId, groupId: operationId, target: change.target, action: cleared ? "retract" : "set",
      scope: { type: "conversation" }, frame: "actual",
      ...(value === undefined ? {} : { value, modality: "preferred" as const, precision: "exact" as const }),
      provenance: { kind: "user_turn", turnId, quote: change.quote },
    }] });
}

/** A derived per-turn summary for the existing public receipt envelope, never another
 * mutation or state store. Individual durable receipts remain the replay authority. */
export function summarizeConditionReceipts(receipts: readonly IntentApplicationReceipt[]): IntentApplicationReceipt | undefined {
  if (!receipts.length) return undefined;
  const first = receipts[0]!, last = receipts[receipts.length - 1]!;
  return { ...last, beforeIntentRevision: first.beforeIntentRevision,
    operations: receipts.flatMap(({ operations }) => operations.map(operation => structuredClone(operation))) };
}

const conditionJournalSchema = z.strictObject({ version: z.literal(1), operations: z.array(z.strictObject({
  target: z.enum(conditionTargets), payloadHash: z.string().regex(/^[0-9a-f]{64}$/u), receipt: z.unknown(),
})).min(1).max(conditionTargets.length) });
export interface ConditionOperationRecord { target: ConditionTarget; payloadHash: string; receipt: IntentApplicationReceipt }
export interface ConditionOperationJournal { version: 1; operations: ConditionOperationRecord[] }

/** Persisted receipt syntax, not another conditions database. Identity is checked against
 * the owning turn so a valid receipt cannot be spliced into a different turn record. */
export function parseConditionJournal(value: unknown, turnId: string): ConditionOperationJournal {
  const parsed = conditionJournalSchema.parse(value), seen = new Set<ConditionTarget>();
  let previousRevision: number | undefined;
  const operations = parsed.operations.map(item => {
    const receipt = parseIntentApplicationReceipt(item.receipt), operation = receipt.operations[0];
    const id = conditionOperationId(turnId, item.target);
    if (seen.has(item.target) || receipt.mutationId !== id || receipt.operations.length !== 1 ||
        !operation || operation.operationId !== id || operation.groupId !== id || operation.target !== item.target ||
        operation.scope.type !== "conversation" || operation.frame !== "actual" || operation.status !== "accepted" ||
        !["set", "retract"].includes(operation.action) || receipt.intentRevision !== receipt.beforeIntentRevision + 1 ||
        previousRevision !== undefined && receipt.beforeIntentRevision !== previousRevision) throw new Error("Invalid condition journal");
    seen.add(item.target); previousRevision = receipt.intentRevision;
    return { target: item.target, payloadHash: item.payloadHash, receipt };
  });
  return { version: 1, operations };
}
