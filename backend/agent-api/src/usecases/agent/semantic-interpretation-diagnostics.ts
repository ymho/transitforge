import { intentModalities, intentSpeechActs, intentTargets, intentUnknownReasons } from "@raiquora/trip/conversation-intent";
import { ConversationModelError } from "../../ports/conversation-model.js";

export type SemanticInterpretationContractFailure =
  | "provider_message"
  | "json_parse"
  | "root_shape"
  | "operation_shape"
  | "value_shape"
  | "value_not_object"
  | "value_kind"
  | "value_fields"
  | "value_constraint"
  | "scope_shape"
  | "quote_verification";

export class SemanticInterpretationContractError extends ConversationModelError {
  override name = "SemanticInterpretationContractError";
  constructor(readonly category: SemanticInterpretationContractFailure) {
    super("invalid_schema", "Semantic interpretation contract validation failed", false);
  }
}



export function parseSemanticInterpretationJson(text: string): unknown {
  const direct = parseJson(text);
  if (direct.ok) return direct.value;

  const trimmed = text.trim();
  const prefix = trimmed.startsWith("```json") ? "```json" : trimmed.startsWith("```") ? "```" : undefined;
  if (!prefix || !trimmed.endsWith("```")) throw new SemanticInterpretationContractError("json_parse");
  const body = trimmed.slice(prefix.length, -3).trim();
  if (!body || body.includes("```")) throw new SemanticInterpretationContractError("json_parse");
  const parsed = parseJson(body);
  if (!parsed.ok) throw new SemanticInterpretationContractError("json_parse");
  return parsed.value;
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try { return { ok: true, value: JSON.parse(text) }; }
  catch { return { ok: false }; }
}

/** Privacy-safe structural classifier for semantic model output.
 * It returns only a closed failure category and never includes model/user content. */
export function semanticInterpretationShapeFailure(value: unknown): Exclude<
  SemanticInterpretationContractFailure,
  "provider_message" | "json_parse" | "quote_verification"
> | undefined {
  if (!record(value) ||
      !only(value, ["outcome", "speechAct", "operations", "unresolvedFragments"]) ||
      !["no_change", "delta", "ambiguous", "unsupported"].includes(String(value.outcome)) ||
      !intentSpeechActs.includes(value.speechAct as never) ||
      !Array.isArray(value.operations) || value.operations.length > 12 ||
      !Array.isArray(value.unresolvedFragments) || value.unresolvedFragments.length > 8 ||
      !value.unresolvedFragments.every(boundedText)) return "root_shape";

  for (const operation of value.operations) {
    if (!record(operation) ||
        !only(operation, ["atomicGroup", "action", "target", "modality", "precision", "frame", "quote", "scope", "value"]) ||
        !Number.isSafeInteger(operation.atomicGroup) || Number(operation.atomicGroup) < 1 || Number(operation.atomicGroup) > 12 ||
        !["set", "add_alternative", "replace", "retract", "relax", "narrow"].includes(String(operation.action)) ||
        !intentTargets.includes(operation.target as never) ||
        operation.modality !== undefined && !intentModalities.includes(operation.modality as never) ||
        operation.precision !== undefined && !["exact", "approximate", "range", "qualitative"].includes(String(operation.precision)) ||
        !["actual", "hypothetical"].includes(String(operation.frame)) ||
        !boundedText(operation.quote)) return "operation_shape";

    if (operation.scope !== undefined && !validScope(operation.scope)) return "scope_shape";

    const action = String(operation.action);
    if (["set", "add_alternative", "replace"].includes(action) && operation.value === undefined ||
        action === "retract" && operation.value !== undefined) return "value_shape";
    if (operation.value !== undefined) {
      const valueFailure = invalidValueReason(operation.value);
      if (valueFailure) return valueFailure;
    }
  }

  if (value.outcome === "delta" && value.operations.length === 0 ||
      value.outcome !== "delta" && value.operations.length !== 0) return "operation_shape";
  return undefined;
}

function validScope(value: unknown): boolean {
  if (!record(value) || typeof value.kind !== "string") return false;
  if (value.kind === "conversation") return only(value, ["kind"]);
  if (value.kind === "logical_day_ordinal") return only(value, ["kind", "ordinal"]) &&
    Number.isSafeInteger(value.ordinal) && Number(value.ordinal) >= 1 && Number(value.ordinal) <= 90;
  if (value.kind === "segment_direction") return only(value, ["kind", "direction"]) &&
    ["outbound", "return"].includes(String(value.direction));
  return false;
}

function invalidValueReason(value: unknown): "value_not_object" | "value_kind" | "value_fields" | "value_constraint" | undefined {
  if (!record(value)) return "value_not_object";
  if (typeof value.kind !== "string") return "value_kind";
  const fields = Object.keys(value);
  const exactFields = (allowed: string[]) => fields.every((field) => allowed.includes(field));
  if (value.kind === "text") return !exactFields(["kind", "text"]) ? "value_fields" : !boundedText(value.text) ? "value_constraint" : undefined;
  if (value.kind === "place_label") return !exactFields(["kind", "label"]) ? "value_fields" : !boundedText(value.label) ? "value_constraint" : undefined;
  if (value.kind === "relative_date") return !exactFields(["kind", "relation"]) ? "value_fields" :
    !["today", "tomorrow", "day_after_tomorrow"].includes(String(value.relation)) ? "value_constraint" : undefined;
  if (value.kind === "month_offset") return !exactFields(["kind", "offset"]) ? "value_fields" :
    !Number.isSafeInteger(value.offset) || Number(value.offset) < -12 || Number(value.offset) > 24 ? "value_constraint" : undefined;
  if (value.kind === "relative_weekday") return !exactFields(["kind", "weekday", "direction"]) ? "value_fields" :
    !Number.isSafeInteger(value.weekday) || Number(value.weekday) < 1 || Number(value.weekday) > 7 ||
    !["next", "on_or_after"].includes(String(value.direction)) ? "value_constraint" : undefined;
  if (value.kind === "local_date") return !exactFields(["kind", "date"]) ? "value_fields" : !validDate(value.date) ? "value_constraint" : undefined;
  if (value.kind === "quantity") return !exactFields(["kind", "amount", "unit"]) ? "value_fields" :
    !Number.isSafeInteger(value.amount) || Number(value.amount) < 0 || !["nights", "days", "people"].includes(String(value.unit)) ? "value_constraint" : undefined;
  if (value.kind === "quantity_range") return !exactFields(["kind", "minimum", "maximum", "unit"]) ? "value_fields" :
    !Number.isSafeInteger(value.minimum) || Number(value.minimum) < 0 || !Number.isSafeInteger(value.maximum) || Number(value.maximum) < 0 ||
    !["nights", "days", "people"].includes(String(value.unit)) ? "value_constraint" : undefined;
  if (value.kind === "money") return !exactFields(["kind", "amount", "currency", "basis"]) ? "value_fields" :
    typeof value.amount !== "number" || !Number.isFinite(value.amount) || value.amount < 0 ||
    value.currency !== undefined && (typeof value.currency !== "string" || !/^[A-Z]{3}$/u.test(value.currency)) ||
    value.basis !== undefined && !["trip", "per_person", "per_night", "per_room"].includes(String(value.basis)) ? "value_constraint" : undefined;
  if (value.kind === "presentation_ordinal") return !exactFields(["kind", "ordinal"]) ? "value_fields" :
    !Number.isSafeInteger(value.ordinal) || Number(value.ordinal) < 1 || Number(value.ordinal) > 24 ? "value_constraint" : undefined;
  if (value.kind === "unknown") return !exactFields(["kind", "reason"]) ? "value_fields" :
    !intentUnknownReasons.includes(value.reason as never) ? "value_constraint" : undefined;
  return "value_kind";
}

function validDate(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function record(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function only(value: Record<string, unknown>, keys: string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}
function boundedText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 300 && !/[\u0000\u007f]/u.test(value);
}
