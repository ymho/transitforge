import { intentModalities, intentSpeechActs, intentTargets, intentUnknownReasons, parseAcceptedIntentDelta,
  type AcceptedIntentDelta, type IntentModality, type IntentPrecision, type IntentSpeechAct, type IntentTarget, type IntentValue } from "@raiquora/trip/conversation-intent";
import { outputContract } from "./output-contract";
import { resolvePresentedCandidate, type ConversationWorkingState } from "./conversation-working-state";

const valueSchema = { anyOf: [
  { type: "object", additionalProperties: false, properties: { kind: { const: "text" }, text: { type: "string", minLength: 1, maxLength: 300 } }, required: ["kind", "text"] },
  { type: "object", additionalProperties: false, properties: { kind: { const: "place_label" }, label: { type: "string", minLength: 1, maxLength: 300 } }, required: ["kind", "label"] },
  { type: "object", additionalProperties: false, properties: { kind: { const: "relative_date" }, relation: { type: "string", enum: ["today", "tomorrow", "day_after_tomorrow"] } }, required: ["kind", "relation"] },
  { type: "object", additionalProperties: false, properties: { kind: { const: "month_offset" }, offset: { type: "integer", minimum: -12, maximum: 24 } }, required: ["kind", "offset"] },
  { type: "object", additionalProperties: false, properties: { kind: { const: "relative_weekday" }, weekday: { type: "integer", minimum: 1, maximum: 7 }, direction: { type: "string", enum: ["next", "on_or_after"] } }, required: ["kind", "weekday", "direction"] },
  { type: "object", additionalProperties: false, properties: { kind: { const: "local_date" }, date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } }, required: ["kind", "date"] },
  { type: "object", additionalProperties: false, properties: { kind: { const: "quantity" }, amount: { type: "integer", minimum: 0 }, unit: { type: "string", enum: ["nights", "days", "people"] } }, required: ["kind", "amount", "unit"] },
  { type: "object", additionalProperties: false, properties: { kind: { const: "quantity_range" }, minimum: { type: "integer", minimum: 0 }, maximum: { type: "integer", minimum: 0 }, unit: { type: "string", enum: ["nights", "days", "people"] } }, required: ["kind", "minimum", "maximum", "unit"] },
  { type: "object", additionalProperties: false, properties: { kind: { const: "money" }, amount: { type: "number", minimum: 0 }, currency: { type: "string", pattern: "^[A-Z]{3}$" }, basis: { type: "string", enum: ["trip", "per_person", "per_night", "per_room"] } }, required: ["kind", "amount"] },
  { type: "object", additionalProperties: false, properties: { kind: { const: "presentation_ordinal" }, ordinal: { type: "integer", minimum: 1, maximum: 24 } }, required: ["kind", "ordinal"] },
  { type: "object", additionalProperties: false, properties: { kind: { const: "unknown" }, reason: { type: "string", enum: [...intentUnknownReasons] } }, required: ["kind", "reason"] },
] };

const operationSchema = {
  type: "object", additionalProperties: false,
  properties: {
    atomicGroup: { type: "integer", minimum: 1, maximum: 12 },
    action: { type: "string", enum: ["set", "add_alternative", "replace", "retract", "relax", "narrow"] },
    target: { type: "string", enum: [...intentTargets] },
    modality: { type: "string", enum: [...intentModalities] },
    precision: { type: "string", enum: ["exact", "approximate", "range", "qualitative"] },
    frame: { type: "string", enum: ["actual", "hypothetical"] },
    quote: { type: "string", minLength: 1, maxLength: 300 },
    value: valueSchema,
  },
  required: ["atomicGroup", "action", "target", "frame", "quote"],
};

export const semanticInterpretationOutputContract = outputContract(
  "conversation_semantic_delta", "1",
  { type: "object", additionalProperties: false, properties: {
    outcome: { type: "string", enum: ["no_change", "delta", "ambiguous", "unsupported"] },
    speechAct: { type: "string", enum: [...intentSpeechActs] },
    operations: { type: "array", maxItems: 12, items: operationSchema },
    unresolvedFragments: { type: "array", maxItems: 8, items: { type: "string", minLength: 1, maxLength: 300 } },
  }, required: ["outcome", "speechAct", "operations", "unresolvedFragments"] },
  "Only the bounded semantic changes in the current user utterance; never IDs, authority, revisions or full state",
);

export type InterpretedIntentValue =
  | Exclude<IntentValue, { kind: "local_date" | "local_month" | "candidate_ref" }>
  | { kind: "relative_date"; relation: "today" | "tomorrow" | "day_after_tomorrow" }
  | { kind: "month_offset"; offset: number }
  | { kind: "relative_weekday"; weekday: number; direction: "next" | "on_or_after" }
  | { kind: "presentation_ordinal"; ordinal: number }
  | { kind: "local_date"; date: string };
export interface InterpretedIntentOperation {
  atomicGroup: number;
  action: "set" | "add_alternative" | "replace" | "retract" | "relax" | "narrow";
  target: IntentTarget;
  modality?: IntentModality;
  precision?: IntentPrecision;
  frame: "actual" | "hypothetical";
  quote: string;
  value?: InterpretedIntentValue;
}
export interface UtteranceInterpretation {
  outcome: "no_change" | "delta" | "ambiguous" | "unsupported";
  speechAct: IntentSpeechAct;
  operations: InterpretedIntentOperation[];
  unresolvedFragments: string[];
}

export function decodeUtteranceInterpretation(value: unknown): UtteranceInterpretation | undefined {
  if (!record(value) || !only(value, ["outcome", "speechAct", "operations", "unresolvedFragments"]) ||
      !["no_change", "delta", "ambiguous", "unsupported"].includes(String(value.outcome)) || !Array.isArray(value.operations) || value.operations.length > 12 ||
      !intentSpeechActs.includes(value.speechAct as IntentSpeechAct) ||
      !Array.isArray(value.unresolvedFragments) || value.unresolvedFragments.length > 8 || !value.unresolvedFragments.every(boundedText)) return undefined;
  const operations = value.operations.map(decodeOperation);
  if (operations.some((operation) => operation === undefined)) return undefined;
  if (value.outcome === "delta" && operations.length === 0 || value.outcome !== "delta" && operations.length !== 0) return undefined;
  return { outcome: value.outcome as UtteranceInterpretation["outcome"], speechAct: value.speechAct as IntentSpeechAct,
    operations: operations as InterpretedIntentOperation[], unresolvedFragments: [...value.unresolvedFragments] };
}

export function acceptedIntentDeltaFromInterpretation(input: {
  interpretation: UtteranceInterpretation;
  userRequest: string;
  turnId: string;
  baseIntentRevision: number;
  calendarDate?: string;
  workingState?: ConversationWorkingState;
}): AcceptedIntentDelta | undefined {
  if (input.interpretation.outcome !== "delta") return undefined;
  const operations = input.interpretation.operations.map((operation, index) => {
    if (!input.userRequest.includes(operation.quote)) throw new Error("Intent quote is not in the current user turn");
    const value = operation.value ? acceptedValue(operation.value, input.calendarDate, operation.quote, input.workingState) : undefined;
    validateTargetValue(operation.target, value, operation.action);
    return {
      operationId: boundedRef(`intent-op:${input.turnId}:${index + 1}`), groupId: boundedRef(`intent-group:${input.turnId}:${operation.atomicGroup}`),
      action: operation.action, target: operation.target, scope: acceptedScope(value, input.workingState),
      ...(operation.modality ? { modality: operation.modality } : {}), ...(operation.precision ? { precision: operation.precision } : {}),
      ...(value ? { value } : {}), frame: operation.frame,
      provenance: { kind: "user_turn" as const, turnId: input.turnId, quote: operation.quote },
    };
  });
  return parseAcceptedIntentDelta({ version: 1, mutationId: boundedRef(`intent-turn:${input.turnId}`), baseIntentRevision: input.baseIntentRevision,
    speechAct: input.interpretation.speechAct, operations });
}

function decodeOperation(value: unknown): InterpretedIntentOperation | undefined {
  if (!record(value) || !only(value, ["atomicGroup", "action", "target", "modality", "precision", "frame", "quote", "value"]) ||
      !Number.isSafeInteger(value.atomicGroup) || Number(value.atomicGroup) < 1 || Number(value.atomicGroup) > 12 ||
      !["set", "add_alternative", "replace", "retract", "relax", "narrow"].includes(String(value.action)) || !intentTargets.includes(value.target as IntentTarget) ||
      value.modality !== undefined && !intentModalities.includes(value.modality as IntentModality) ||
      value.precision !== undefined && !["exact", "approximate", "range", "qualitative"].includes(String(value.precision)) ||
      !["actual", "hypothetical"].includes(String(value.frame)) || !boundedText(value.quote)) return undefined;
  const action = value.action as InterpretedIntentOperation["action"], decodedValue = value.value === undefined ? undefined : decodeValue(value.value);
  if (value.value !== undefined && !decodedValue || ["set", "add_alternative", "replace"].includes(action) && !decodedValue || action === "retract" && decodedValue) return undefined;
  return { atomicGroup: value.atomicGroup, action, target: value.target as IntentTarget,
    ...(value.modality ? { modality: value.modality as IntentModality } : {}), ...(value.precision ? { precision: value.precision as IntentPrecision } : {}),
    frame: value.frame as "actual" | "hypothetical", quote: value.quote, ...(decodedValue ? { value: decodedValue } : {}) };
}

function decodeValue(value: unknown): InterpretedIntentValue | undefined {
  if (!record(value) || typeof value.kind !== "string") return undefined;
  if (value.kind === "candidate_ref") return undefined; // Application-owned resolved reference.
  if (value.kind === "relative_date" && only(value, ["kind", "relation"]) && ["today", "tomorrow", "day_after_tomorrow"].includes(String(value.relation)))
    return { kind: "relative_date", relation: value.relation as "today" | "tomorrow" | "day_after_tomorrow" };
  if (value.kind === "month_offset" && only(value, ["kind", "offset"]) && Number.isSafeInteger(value.offset) && Number(value.offset) >= -12 && Number(value.offset) <= 24)
    return { kind: "month_offset", offset: Number(value.offset) };
  if (value.kind === "relative_weekday" && only(value, ["kind", "weekday", "direction"]) && Number.isSafeInteger(value.weekday) && Number(value.weekday) >= 1 && Number(value.weekday) <= 7 &&
      ["next", "on_or_after"].includes(String(value.direction))) return { kind: "relative_weekday", weekday: Number(value.weekday), direction: value.direction as "next" | "on_or_after" };
  if (value.kind === "presentation_ordinal" && only(value, ["kind", "ordinal"]) && Number.isSafeInteger(value.ordinal) && Number(value.ordinal) >= 1 && Number(value.ordinal) <= 24)
    return { kind: "presentation_ordinal", ordinal: Number(value.ordinal) };
  if (value.kind === "local_date" && only(value, ["kind", "date"]) && validDate(value.date)) return { kind: "local_date", date: value.date };
  try {
    const delta = parseAcceptedIntentDelta({ version: 1, mutationId: "decode", baseIntentRevision: 0, speechAct: "inform", operations: [{ operationId: "decode-op", groupId: "decode-group",
      action: "set", target: targetForValue(value.kind), scope: { type: "conversation" }, modality: "preferred", precision: "exact", value, frame: "actual",
      provenance: { kind: "user_turn", turnId: "00000000-0000-4000-8000-000000000000", quote: "decode" } }] });
    return delta.operations[0]!.value as InterpretedIntentValue;
  } catch { return undefined; }
}

function targetForValue(kind: unknown): IntentTarget {
  if (kind === "place_label") return "destination";
  if (kind === "quantity" || kind === "quantity_range") return "duration";
  if (kind === "money") return "budget";
  return "goal";
}

function acceptedValue(value: InterpretedIntentValue, anchor: string | undefined, quote: string, workingState?: ConversationWorkingState): IntentValue {
  if (value.kind === "relative_date" || value.kind === "month_offset" || value.kind === "relative_weekday") {
    if (!anchor || !validDate(anchor)) throw new Error("Relative date requires a trusted calendar anchor");
    if (value.kind === "relative_date") {
      const offset = value.relation === "today" ? 0 : value.relation === "tomorrow" ? 1 : 2;
      return { kind: "local_date", date: stepDate(anchor, offset), expression: value.relation, anchorDate: anchor, resolverVersion: "calendar-v1" };
    }
    if (value.kind === "month_offset") return { kind: "local_month", month: stepMonth(anchor, value.offset), expression: "month_offset",
      anchorDate: anchor, resolverVersion: "calendar-v1" };
    const anchorWeekday = isoWeekday(anchor);
    let offset = (value.weekday - anchorWeekday + 7) % 7;
    if (value.direction === "next" && offset === 0) offset = 7;
    return { kind: "local_date", date: stepDate(anchor, offset), expression: "relative_weekday", anchorDate: anchor, resolverVersion: "calendar-v1" };
  }
  if (value.kind === "presentation_ordinal") {
    if (!ordinalAppearsInQuote(quote, value.ordinal)) throw new Error("Presentation ordinal is not present in the user quote");
    const presentation = workingState?.presentations.at(-1);
    if (!workingState || !presentation || presentation.target?.tripId && presentation.target.tripId !== workingState.target.tripId) throw new Error("Presentation reference is unavailable");
    const candidateRef = resolvePresentedCandidate({ state: workingState, presentationId: presentation.presentationId,
      version: presentation.version, ordinal: value.ordinal });
    if (!candidateRef) throw new Error("Presentation ordinal is unavailable");
    return { kind: "candidate_ref", presentationId: presentation.presentationId, presentationVersion: 1, candidateRef };
  }
  if (value.kind === "local_date" && !explicitLocalDateInQuote(quote, value.date)) throw new Error("Exact date is not present in the user quote");
  return structuredClone(value);
}

function validateTargetValue(target: IntentTarget, value: IntentValue | undefined, action: InterpretedIntentOperation["action"]): void {
  if (["retract", "relax", "narrow"].includes(action)) return;
  if (!value) throw new Error("Intent value is required");
  if ((target === "origin" || target === "destination") && !["place_label", "unknown"].includes(value.kind)) throw new Error("Place intent requires a label");
  if ((target === "start_date" || target === "end_date") && !["local_date", "local_month", "unknown"].includes(value.kind)) throw new Error("Date intent requires a date");
  if (target === "duration" && !["quantity", "quantity_range", "unknown"].includes(value.kind)) throw new Error("Duration intent requires a quantity");
  if (target === "party_size" && !(value.kind === "quantity" && value.unit === "people") && value.kind !== "unknown") throw new Error("Party intent requires people");
  if (target === "budget" && !["money", "unknown"].includes(value.kind)) throw new Error("Budget intent requires money");
  if (target === "candidate_selection" && !["candidate_ref", "unknown"].includes(value.kind)) throw new Error("Candidate selection requires a verified presentation reference");
}

function acceptedScope(value: IntentValue | undefined, workingState?: ConversationWorkingState): AcceptedIntentDelta["operations"][number]["scope"] {
  if (value?.kind !== "candidate_ref") return { type: "conversation" };
  const presentation = workingState?.presentations.find(({ presentationId, version }) => presentationId === value.presentationId && version === value.presentationVersion);
  return presentation?.target ? { type: "trip", tripId: presentation.target.tripId } : { type: "conversation" };
}

function stepDate(value: string, days: number): string { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function stepMonth(value: string, months: number): string { const date = new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1 + months, 1)); return date.toISOString().slice(0, 7); }
function isoWeekday(value: string): number { const day = new Date(`${value}T12:00:00Z`).getUTCDay(); return day === 0 ? 7 : day; }
function explicitLocalDateInQuote(quote: string, date: string): boolean {
  const [year, month, day] = date.split("-").map(Number);
  return quote.includes(date) || quote.includes(`${year}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`) ||
    quote.includes(`${year}年${month}月${day}日`);
}
function ordinalAppearsInQuote(quote: string, ordinal: number): boolean {
  const japanese = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
  return new RegExp(`(?:${ordinal}|${japanese[ordinal - 1] ?? "(?!)"})(?:番目|つ目|番)`, "u").test(quote);
}
function validDate(value: unknown): value is string { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false; const date = new Date(`${value}T00:00:00Z`); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value; }
function record(value: unknown): value is Record<string, any> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function only(value: Record<string, unknown>, keys: string[]): boolean { const allowed = new Set(keys); return Object.keys(value).every((key) => allowed.has(key)); }
function boundedText(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= 300 && !/[\u0000\u007f]/u.test(value); }
function boundedRef(value: string): string { return value.length <= 200 ? value : value.slice(0, 200); }
