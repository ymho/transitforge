import { z } from "zod";
import { parseAcceptedIntentDelta, type AcceptedIntentDelta, type ConversationIntentOverlay } from "@raiquora/trip/conversation-intent";
import { parseIntentApplicationReceipt, type IntentApplicationReceipt } from "./conversation-intent-reducer";

/** Set and clear are distinct business commands. Omitted/unknown values must never
 * be confused with retraction. Places are user labels, not geocoded facts. */
const sourceQuote = z.string().min(1).max(300).describe("この操作を求めるuserMessageの完全な部分文字列。");
const placeLabel = z.string().min(1).max(200).regex(/^(?!\s)(?![\s\S]*\s$)[^\u0000-\u001f\u007f<>]+$/u)
  .describe("今回の発言からそのまま取り出した地名。");
export const placeConditionInputSchema = z.strictObject({ place: placeLabel, quote: sourceQuote });
export const clearConditionInputSchema = z.strictObject({ quote: sourceQuote });
export const conditionTargets = ["origin", "destination"] as const;
/** Internal command only. Tools cannot choose target, identity, scope or revision. */
export const conversationConditionSchema = placeConditionInputSchema.extend({
  target: z.enum(conditionTargets), place: placeLabel.nullable(),
});
export type PlaceConditionInput = z.infer<typeof placeConditionInputSchema>;
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
  if (!userMessage.includes(change.quote) || change.place !== null && !change.quote.includes(change.place))
    throw new ConditionUpdateRejectedError("invalid_source");
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
  return JSON.stringify([1, change.target, change.place]);
}

/** Adapt a validated business operation directly to the existing pure reducer.
 * No UtteranceInterpretation, legacy decoder, model call, clock or Provider is involved. */
export function conditionDelta(change: ConversationConditionChange, turnId: string, overlay: ConversationIntentOverlay): AcceptedIntentDelta {
  const operationId = conditionOperationId(turnId, change.target);
  return parseAcceptedIntentDelta({ version: 1, mutationId: operationId, baseIntentRevision: overlay.intentRevision,
    speechAct: change.place === null ? "cancel" : "inform", operations: [{
      operationId, groupId: operationId, target: change.target, action: change.place === null ? "retract" : "set",
      scope: { type: "conversation" }, frame: "actual",
      ...(change.place === null ? {} : { value: { kind: "place_label", label: change.place }, modality: "preferred", precision: "exact" }),
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
