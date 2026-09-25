import { intentModalities, intentTargets, intentUnknownReasons, parseAcceptedIntentDelta,
  type AcceptedIntentDelta, type IntentModality, type IntentPrecision, type IntentTarget, type IntentValue } from "@raiquora/trip/conversation-intent";
import { outputContract } from "./output-contract";

const valueSchema = { anyOf: [
  { type: "object", additionalProperties: false, properties: { kind: { const: "text" }, text: { type: "string", minLength: 1, maxLength: 300 } }, required: ["kind", "text"] },
  { type: "object", additionalProperties: false, properties: { kind: { const: "place_label" }, label: { type: "string", minLength: 1, maxLength: 300 } }, required: ["kind", "label"] },
  { type: "object", additionalProperties: false, properties: { kind: { const: "relative_date" }, relation: { type: "string", enum: ["today", "tomorrow", "day_after_tomorrow"] } }, required: ["kind", "relation"] },
  { type: "object", additionalProperties: false, properties: { kind: { const: "local_date" }, date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } }, required: ["kind", "date"] },
  { type: "object", additionalProperties: false, properties: { kind: { const: "quantity" }, amount: { type: "integer", minimum: 0 }, unit: { type: "string", enum: ["nights", "days", "people"] } }, required: ["kind", "amount", "unit"] },
  { type: "object", additionalProperties: false, properties: { kind: { const: "quantity_range" }, minimum: { type: "integer", minimum: 0 }, maximum: { type: "integer", minimum: 0 }, unit: { type: "string", enum: ["nights", "days", "people"] } }, required: ["kind", "minimum", "maximum", "unit"] },
  { type: "object", additionalProperties: false, properties: { kind: { const: "money" }, amount: { type: "number", minimum: 0 }, currency: { type: "string", pattern: "^[A-Z]{3}$" }, basis: { type: "string", enum: ["trip", "per_person", "per_night", "per_room"] } }, required: ["kind", "amount"] },
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
    operations: { type: "array", maxItems: 12, items: operationSchema },
    unresolvedFragments: { type: "array", maxItems: 8, items: { type: "string", minLength: 1, maxLength: 300 } },
  }, required: ["outcome", "operations", "unresolvedFragments"] },
  "Only the bounded semantic changes in the current user utterance; never IDs, authority, revisions or full state",
);

export type InterpretedIntentValue =
  | Exclude<IntentValue, { kind: "local_date" }>
  | { kind: "relative_date"; relation: "today" | "tomorrow" | "day_after_tomorrow" }
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
  operations: InterpretedIntentOperation[];
  unresolvedFragments: string[];
}

export function decodeUtteranceInterpretation(value: unknown): UtteranceInterpretation | undefined {
  if (!record(value) || !only(value, ["outcome", "operations", "unresolvedFragments"]) ||
      !["no_change", "delta", "ambiguous", "unsupported"].includes(String(value.outcome)) || !Array.isArray(value.operations) || value.operations.length > 12 ||
      !Array.isArray(value.unresolvedFragments) || value.unresolvedFragments.length > 8 || !value.unresolvedFragments.every(boundedText)) return undefined;
  const operations = value.operations.map(decodeOperation);
  if (operations.some((operation) => operation === undefined)) return undefined;
  if (value.outcome === "delta" && operations.length === 0 || value.outcome !== "delta" && operations.length !== 0) return undefined;
  return { outcome: value.outcome as UtteranceInterpretation["outcome"], operations: operations as InterpretedIntentOperation[], unresolvedFragments: [...value.unresolvedFragments] };
}

export function acceptedIntentDeltaFromInterpretation(input: {
  interpretation: UtteranceInterpretation;
  userRequest: string;
  turnId: string;
  baseIntentRevision: number;
  calendarDate?: string;
}): AcceptedIntentDelta | undefined {
  if (input.interpretation.outcome !== "delta") return undefined;
  const operations = input.interpretation.operations.map((operation, index) => {
    if (!input.userRequest.includes(operation.quote)) throw new Error("Intent quote is not in the current user turn");
    const value = operation.value ? acceptedValue(operation.value, input.calendarDate) : undefined;
    validateTargetValue(operation.target, value, operation.action);
    return {
      operationId: boundedRef(`intent-op:${input.turnId}:${index + 1}`), groupId: boundedRef(`intent-group:${input.turnId}:${operation.atomicGroup}`),
      action: operation.action, target: operation.target, scope: { type: "conversation" as const },
      ...(operation.modality ? { modality: operation.modality } : {}), ...(operation.precision ? { precision: operation.precision } : {}),
      ...(value ? { value } : {}), frame: operation.frame,
      provenance: { kind: "user_turn" as const, turnId: input.turnId, quote: operation.quote },
    };
  });
  return parseAcceptedIntentDelta({ version: 1, mutationId: boundedRef(`intent-turn:${input.turnId}`), baseIntentRevision: input.baseIntentRevision, operations });
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
  if (value.kind === "relative_date" && only(value, ["kind", "relation"]) && ["today", "tomorrow", "day_after_tomorrow"].includes(String(value.relation)))
    return { kind: "relative_date", relation: value.relation as "today" | "tomorrow" | "day_after_tomorrow" };
  if (value.kind === "local_date" && only(value, ["kind", "date"]) && validDate(value.date)) return { kind: "local_date", date: value.date };
  try {
    const delta = parseAcceptedIntentDelta({ version: 1, mutationId: "decode", baseIntentRevision: 0, operations: [{ operationId: "decode-op", groupId: "decode-group",
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

function acceptedValue(value: InterpretedIntentValue, anchor?: string): IntentValue {
  if (value.kind === "relative_date") {
    if (!anchor || !validDate(anchor)) throw new Error("Relative date requires a trusted calendar anchor");
    const offset = value.relation === "today" ? 0 : value.relation === "tomorrow" ? 1 : 2;
    return { kind: "local_date", date: stepDate(anchor, offset), expression: value.relation };
  }
  return structuredClone(value);
}

function validateTargetValue(target: IntentTarget, value: IntentValue | undefined, action: InterpretedIntentOperation["action"]): void {
  if (["retract", "relax", "narrow"].includes(action)) return;
  if (!value) throw new Error("Intent value is required");
  if ((target === "origin" || target === "destination") && !["place_label", "unknown"].includes(value.kind)) throw new Error("Place intent requires a label");
  if ((target === "start_date" || target === "end_date") && !["local_date", "unknown"].includes(value.kind)) throw new Error("Date intent requires a date");
  if (target === "duration" && !["quantity", "quantity_range", "unknown"].includes(value.kind)) throw new Error("Duration intent requires a quantity");
  if (target === "party_size" && !(value.kind === "quantity" && value.unit === "people") && value.kind !== "unknown") throw new Error("Party intent requires people");
  if (target === "budget" && !["money", "unknown"].includes(value.kind)) throw new Error("Budget intent requires money");
}

function stepDate(value: string, days: number): string { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function validDate(value: unknown): value is string { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false; const date = new Date(`${value}T00:00:00Z`); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value; }
function record(value: unknown): value is Record<string, any> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function only(value: Record<string, unknown>, keys: string[]): boolean { const allowed = new Set(keys); return Object.keys(value).every((key) => allowed.has(key)); }
function boundedText(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= 300 && !/[\u0000\u007f]/u.test(value); }
function boundedRef(value: string): string { return value.length <= 200 ? value : value.slice(0, 200); }
