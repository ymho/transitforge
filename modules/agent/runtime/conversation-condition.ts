import { z } from "zod";
import { parseAcceptedIntentDelta, type AcceptedIntentDelta, type ConversationIntentOverlay } from "@raiquora/trip/conversation-intent";
import type { IntentApplicationReceipt } from "./conversation-intent-reducer";

/** Each Tool accepts one independently meaningful condition, not an interpretation report.
 * null explicitly retracts the condition (and suppresses inherited/profile defaults).
 * A place is a user-supplied label, not a geocoded or externally verified location. */
export const placeConditionInputSchema = z.strictObject({
  place: z.string().min(1).max(200).regex(/^(?!\s)(?![\s\S]*\s$)[^\u0000-\u001f\u007f<>]+$/u).nullable()
    .describe("今回の発言からそのまま取り出した地名。未定に戻す・撤回する場合だけnull。"),
  quote: z.string().min(1).max(300).describe("この更新・撤回の根拠となるuserMessageの完全な部分文字列。"),
});
export const conditionTargets = ["origin", "destination"] as const;
export const conversationConditionSchema = placeConditionInputSchema.extend({ target: z.enum(conditionTargets) });
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
