import { z } from "zod";
import { parseAcceptedIntentDelta, type AcceptedIntentDelta, type ConversationIntentOverlay, type IntentValue } from "@raiquora/trip/conversation-intent";
import { validateTripParty } from "@raiquora/trip/trip-party";
import { parseIntentApplicationReceipt, type IntentApplicationReceipt } from "./conversation-intent-reducer";

const sourceQuote = z.string().min(1).max(300).describe("この操作を求めるuserMessageの完全な部分文字列。");
const placeLabel = z.string().min(1).max(200).regex(/^(?!\s)(?![\s\S]*\s$)[^\u0000-\u001f\u007f<>]+$/u)
  .describe("今回の発言からそのまま取り出した地名。");
export const placeConditionInputSchema = z.strictObject({ place: placeLabel, quote: sourceQuote });
export const clearConditionInputSchema = z.strictObject({ quote: sourceQuote });
export const placeConditionUpdateInputSchema = z.strictObject({
  action: z.enum(["set", "clear"]),
  place: placeLabel.optional(),
  quote: sourceQuote,
}).superRefine((value, context) => {
  if (value.action === "set" && value.place === undefined) context.addIssue({ code: "custom", message: "set requires place" });
  if (value.action === "clear" && value.place !== undefined) context.addIssue({ code: "custom", message: "clear must not include place" });
});

const partyCount = z.strictObject({
  kind: z.literal("count"),
  people: z.number().int().min(1).max(20).describe("明示された合計人数。大人/子どもの内訳は推測しない。"),
});
const partyComposition = z.strictObject({
  kind: z.literal("composition"),
  adults: z.number().int().min(0).max(20),
  children: z.number().int().min(0).max(20).describe("明示された子どもの人数。年齢・年代・関係性はこのToolでは扱わない。"),
}).refine((value) => value.adults + value.children >= 1 && value.adults + value.children <= 20, { message: "同行者は1〜20人にする" });
export const partyConditionValueSchema = z.union([partyCount, partyComposition]);
export const partyConditionInputSchema = z.strictObject({
  party: partyConditionValueSchema.describe("今回の同行者。合計だけならcount、明示された大人/子どもの人数がある時だけcomposition。"),
  quote: sourceQuote,
});
export const partyConditionUpdateInputSchema = z.strictObject({
  action: z.enum(["set", "clear"]),
  party: partyConditionValueSchema.optional(),
  quote: sourceQuote,
}).superRefine((value, context) => {
  if (value.action === "set" && value.party === undefined) context.addIssue({ code: "custom", message: "set requires party" });
  if (value.action === "clear" && value.party !== undefined) context.addIssue({ code: "custom", message: "clear must not include party" });
});

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
export const periodDateExpressionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("local_date"), date: localDate }),
  z.strictObject({ kind: z.literal("month_day"), month: z.number().int().min(1).max(12), day: z.number().int().min(1).max(31) }),
  z.strictObject({ kind: z.literal("day_of_month"), day: z.number().int().min(1).max(31) }),
  z.strictObject({ kind: z.literal("relative_date"), relation: z.enum(["today", "tomorrow", "day_after_tomorrow"]) }),
]);
export const travelDurationSchema = z.strictObject({
  amount: z.number().int().min(1).max(90),
  unit: z.enum(["days", "nights"]),
});
export const travelPeriodValueSchema = z.strictObject({
  start: periodDateExpressionSchema.optional(),
  end: periodDateExpressionSchema.optional(),
  duration: travelDurationSchema.optional(),
}).refine(value => value.start !== undefined || value.end !== undefined || value.duration !== undefined, {
  message: "travel period requires at least one explicit component",
});
export const travelPeriodUpdateInputSchema = z.strictObject({
  action: z.enum(["set", "clear"]),
  period: travelPeriodValueSchema.optional(),
  quote: sourceQuote,
}).superRefine((value, context) => {
  if (value.action === "set" && value.period === undefined) context.addIssue({ code: "custom", message: "set requires period" });
  if (value.action === "clear" && value.period !== undefined) context.addIssue({ code: "custom", message: "clear must not include period" });
});

export const tripScenarioInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("party"), party: partyConditionValueSchema, quote: sourceQuote }),
  z.strictObject({ kind: z.literal("travel_period"), period: travelPeriodValueSchema, quote: sourceQuote }),
]);

const resolvedDateSchema = z.strictObject({
  kind: z.literal("local_date"),
  date: localDate,
  expression: z.enum(["today", "tomorrow", "day_after_tomorrow"]).optional(),
  anchorDate: localDate.optional(),
  resolverVersion: z.literal("calendar-v1").optional(),
});
const resolvedPeriodSchema = z.strictObject({
  start: resolvedDateSchema.optional(),
  end: resolvedDateSchema.optional(),
  duration: travelDurationSchema.optional(),
}).refine(value => value.start !== undefined || value.end !== undefined || value.duration !== undefined, {
  message: "resolved travel period requires at least one component",
});

export const conditionSlots = ["origin", "destination", "party_size", "travel_period"] as const;
const placeInputSchema = z.strictObject({ target: z.enum(["origin", "destination"]), place: placeLabel.nullable(), quote: sourceQuote });
const partyInputSchema = z.strictObject({ target: z.literal("party_size"), party: partyConditionValueSchema.nullable(), quote: sourceQuote });
const periodInputSchema = z.strictObject({ target: z.literal("travel_period"), period: travelPeriodValueSchema.nullable(), quote: sourceQuote });
export const conversationConditionInputSchema = z.union([placeInputSchema, partyInputSchema, periodInputSchema]);

const placeChangeSchema = placeInputSchema;
const partyChangeSchema = partyInputSchema;
const periodChangeSchema = z.strictObject({ target: z.literal("travel_period"), period: resolvedPeriodSchema.nullable(), quote: sourceQuote });
export const conversationConditionSchema = z.union([placeChangeSchema, partyChangeSchema, periodChangeSchema]);

export type PlaceConditionInput = z.infer<typeof placeConditionInputSchema>;
export type PartyConditionInput = z.infer<typeof partyConditionInputSchema>;
export type PlaceConditionUpdateInput = z.infer<typeof placeConditionUpdateInputSchema>;
export type PartyConditionUpdateInput = z.infer<typeof partyConditionUpdateInputSchema>;
export type TravelPeriodUpdateInput = z.infer<typeof travelPeriodUpdateInputSchema>;
export type TripScenarioInput = z.infer<typeof tripScenarioInputSchema>;
export type ConversationConditionInput = z.infer<typeof conversationConditionInputSchema>;
export type ConversationConditionChange = z.infer<typeof conversationConditionSchema>;
export type ConditionSlot = typeof conditionSlots[number];
/** Backwards-compatible alias for existing condition journal callers. */
export type ConditionTarget = ConditionSlot;

export class ConditionUpdateRejectedError extends Error {
  constructor(readonly code: "invalid_condition" | "invalid_source" | "condition_conflict") {
    super(code); this.name = "ConditionUpdateRejectedError";
  }
}

export function admitTripScenario(value: unknown, userMessage: string): TripScenarioInput {
  const parsed = tripScenarioInputSchema.safeParse(value);
  if (!parsed.success) throw new ConditionUpdateRejectedError("invalid_condition");
  if (!userMessage.includes(parsed.data.quote)) throw new ConditionUpdateRejectedError("invalid_source");
  return parsed.data;
}

/** Syntax is shared with the SDK. Source grounding and calendar resolution belong
 * to Application admission, not to the model or a legacy semantic interpreter. */
export function admitConditionChange(value: unknown, userMessage: string, calendarDate?: string): ConversationConditionChange {
  const parsed = conversationConditionInputSchema.safeParse(value);
  if (!parsed.success) throw new ConditionUpdateRejectedError("invalid_condition");
  const input = parsed.data;
  if (!userMessage.includes(input.quote)) throw new ConditionUpdateRejectedError("invalid_source");
  if ("place" in input && input.place !== null && !input.quote.includes(input.place))
    throw new ConditionUpdateRejectedError("invalid_source");
  if ("party" in input && input.party?.kind === "composition") {
    try {
      validateTripParty({ adults: input.party.adults, children: Array.from({ length: input.party.children }, () => ({})), source: "user" });
    } catch { throw new ConditionUpdateRejectedError("invalid_condition"); }
  }
  if (input.target !== "travel_period" || input.period === null) return input;
  const period = resolveTravelPeriod(input.period, input.quote, calendarDate);
  return { target: "travel_period", period, quote: input.quote };
}

/** Application-issued identity: one final decision per business slot per user message. */
export function conditionOperationId(turnId: string, slot: ConditionSlot): string {
  return `condition:${turnId}:${slot}`;
}
export function conditionSlot(change: ConversationConditionChange): ConditionSlot { return change.target; }
export function conditionPayload(change: ConversationConditionChange): string {
  if ("place" in change) return JSON.stringify([2, change.target, change.place]);
  if ("party" in change) return JSON.stringify([2, change.target, change.party]);
  return JSON.stringify([2, change.target, change.period]);
}

/** One business slot may map to several atomic Domain operations. */
export function conditionDelta(change: ConversationConditionChange, turnId: string, overlay: ConversationIntentOverlay): AcceptedIntentDelta {
  const slot = conditionSlot(change), mutationId = conditionOperationId(turnId, slot);
  if (change.target === "travel_period") return travelPeriodDelta(change, turnId, overlay, mutationId);
  const cleared = "place" in change ? change.place === null : change.party === null;
  let value: IntentValue | undefined;
  if (!cleared && "place" in change) value = { kind: "place_label", label: change.place! };
  if (!cleared && "party" in change && change.party?.kind === "count") value = { kind: "quantity", amount: change.party.people, unit: "people" };
  if (!cleared && "party" in change && change.party?.kind === "composition")
    value = { kind: "party", adults: change.party.adults, children: Array.from({ length: change.party.children }, () => ({})) };
  return parseAcceptedIntentDelta({ version: 1, mutationId, baseIntentRevision: overlay.intentRevision,
    speechAct: cleared ? "cancel" : "inform", operations: [{
      operationId: mutationId, groupId: mutationId, target: change.target, action: cleared ? "retract" : "set",
      scope: { type: "conversation" }, frame: "actual",
      ...(value === undefined ? {} : { value, modality: "preferred" as const, precision: "exact" as const }),
      provenance: { kind: "user_turn", turnId, quote: change.quote },
    }] });
}

function travelPeriodDelta(change: Extract<ConversationConditionChange, { target: "travel_period" }>, turnId: string,
  overlay: ConversationIntentOverlay, mutationId: string): AcceptedIntentDelta {
  const values: Record<"start_date" | "end_date" | "duration", IntentValue | undefined> = {
    start_date: change.period?.start,
    end_date: change.period?.end,
    duration: change.period?.duration ? { kind: "quantity", amount: change.period.duration.amount, unit: change.period.duration.unit } : undefined,
  };
  const operations = (["start_date", "end_date", "duration"] as const).map(target => {
    const value = values[target], operationId = `${mutationId}:${target}`;
    return {
      operationId, groupId: mutationId, target, action: value === undefined ? "retract" as const : "set" as const,
      scope: { type: "conversation" as const }, frame: "actual" as const,
      ...(value === undefined ? {} : { value, modality: "preferred" as const, precision: "exact" as const }),
      provenance: { kind: "user_turn" as const, turnId, quote: change.quote },
    };
  });
  return parseAcceptedIntentDelta({ version: 1, mutationId, baseIntentRevision: overlay.intentRevision,
    speechAct: change.period === null ? "cancel" : "inform", operations });
}

/** A derived per-turn summary for the existing public receipt envelope. */
export function summarizeConditionReceipts(receipts: readonly IntentApplicationReceipt[]): IntentApplicationReceipt | undefined {
  if (!receipts.length) return undefined;
  const first = receipts[0]!, last = receipts[receipts.length - 1]!;
  return { ...last, beforeIntentRevision: first.beforeIntentRevision,
    operations: receipts.flatMap(({ operations }) => operations.map(operation => structuredClone(operation))) };
}

const conditionJournalSchema = z.strictObject({ version: z.literal(1), operations: z.array(z.strictObject({
  target: z.enum(conditionSlots), payloadHash: z.string().regex(/^[0-9a-f]{64}$/u), receipt: z.unknown(),
})).min(1).max(conditionSlots.length) });
export interface ConditionOperationRecord { target: ConditionSlot; payloadHash: string; receipt: IntentApplicationReceipt }
export interface ConditionOperationJournal { version: 1; operations: ConditionOperationRecord[] }

export function parseConditionJournal(value: unknown, turnId: string): ConditionOperationJournal {
  const parsed = conditionJournalSchema.parse(value), seen = new Set<ConditionSlot>();
  let previousRevision: number | undefined;
  const operations = parsed.operations.map(item => {
    const receipt = parseIntentApplicationReceipt(item.receipt), id = conditionOperationId(turnId, item.target);
    if (seen.has(item.target) || receipt.mutationId !== id || receipt.intentRevision !== receipt.beforeIntentRevision + 1 ||
        previousRevision !== undefined && receipt.beforeIntentRevision !== previousRevision) throw new Error("Invalid condition journal");
    if (item.target === "travel_period") {
      const expected = new Set(["start_date", "end_date", "duration"]);
      if (receipt.operations.length !== 3 || receipt.operations.some(operation =>
        !expected.delete(operation.target) || operation.operationId !== `${id}:${operation.target}` || operation.groupId !== id ||
        operation.scope.type !== "conversation" || operation.frame !== "actual" || operation.status !== "accepted" ||
        !["set", "retract"].includes(operation.action)) || expected.size) throw new Error("Invalid condition journal");
    } else {
      const operation = receipt.operations[0];
      if (receipt.operations.length !== 1 || !operation || operation.operationId !== id || operation.groupId !== id ||
          operation.target !== item.target || operation.scope.type !== "conversation" || operation.frame !== "actual" ||
          operation.status !== "accepted" || !["set", "retract"].includes(operation.action)) throw new Error("Invalid condition journal");
    }
    seen.add(item.target); previousRevision = receipt.intentRevision;
    return { target: item.target, payloadHash: item.payloadHash, receipt };
  });
  return { version: 1, operations };
}

function resolveTravelPeriod(value: z.infer<typeof travelPeriodValueSchema>, quote: string, anchor?: string): z.infer<typeof resolvedPeriodSchema> {
  const start = value.start ? resolvePeriodDate(value.start, quote, anchor) : undefined;
  const end = value.end ? resolvePeriodDate(value.end, quote, anchor, start?.date) : undefined;
  if (start && end && end.date < start.date) throw new ConditionUpdateRejectedError("invalid_condition");
  if (start && end && value.duration) {
    const days = differenceInDays(start.date, end.date);
    const expected = value.duration.unit === "nights" ? days : days + 1;
    if (expected !== value.duration.amount) throw new ConditionUpdateRejectedError("invalid_condition");
  }
  return {
    ...(start ? { start } : {}), ...(end ? { end } : {}), ...(value.duration ? { duration: { ...value.duration } } : {}),
  };
}

function resolvePeriodDate(value: z.infer<typeof periodDateExpressionSchema>, quote: string, anchor?: string,
  sameMonthReference?: string): z.infer<typeof resolvedDateSchema> {
  if (value.kind === "local_date") {
    if (!validDate(value.date) || !explicitDateAppears(quote, value.date)) throw new ConditionUpdateRejectedError("invalid_source");
    return { kind: "local_date", date: value.date };
  }
  if (value.kind === "relative_date") {
    if (!anchor || !validDate(anchor) || !relativeDateAppears(quote, value.relation)) throw new ConditionUpdateRejectedError(anchor ? "invalid_source" : "invalid_condition");
    const offset = value.relation === "today" ? 0 : value.relation === "tomorrow" ? 1 : 2;
    return { kind: "local_date", date: stepDate(anchor, offset), expression: value.relation, anchorDate: anchor, resolverVersion: "calendar-v1" };
  }
  if (value.kind === "day_of_month") {
    if (!sameMonthReference || !quote.includes(`${value.day}日`)) throw new ConditionUpdateRejectedError("invalid_source");
    const date = `${sameMonthReference.slice(0, 8)}${String(value.day).padStart(2, "0")}`;
    if (!validDate(date)) throw new ConditionUpdateRejectedError("invalid_condition");
    return { kind: "local_date", date };
  }
  if (!anchor || !validDate(anchor) || !monthDayAppears(quote, value.month, value.day))
    throw new ConditionUpdateRejectedError(anchor ? "invalid_source" : "invalid_condition");
  const year = Number(anchor.slice(0, 4));
  let date = isoDate(year, value.month, value.day);
  if (!date) throw new ConditionUpdateRejectedError("invalid_condition");
  if (date < anchor) date = isoDate(year + 1, value.month, value.day);
  if (!date) throw new ConditionUpdateRejectedError("invalid_condition");
  return { kind: "local_date", date, anchorDate: anchor, resolverVersion: "calendar-v1" };
}

function relativeDateAppears(quote: string, relation: "today" | "tomorrow" | "day_after_tomorrow"): boolean {
  if (relation === "today") return quote.includes("今日") || quote.includes("本日");
  if (relation === "tomorrow") return quote.includes("明日");
  return quote.includes("明後日") || quote.includes("あさって");
}
function explicitDateAppears(quote: string, date: string): boolean {
  const [year, month, day] = date.split("-").map(Number);
  return quote.includes(date) || quote.includes(`${year}/${month}/${day}`) || quote.includes(`${year}年${month}月${day}日`);
}
function monthDayAppears(quote: string, month: number, day: number): boolean {
  return quote.includes(`${month}月${day}日`) || quote.includes(`${month}/${day}`) ||
    quote.includes(`${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`);
}
function isoDate(year: number, month: number, day: number): string | undefined {
  const value = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return validDate(value) ? value : undefined;
}
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function stepDate(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10);
}
function differenceInDays(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}
