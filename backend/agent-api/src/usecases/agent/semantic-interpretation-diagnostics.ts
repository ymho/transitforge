import { intentModalities, intentSpeechActs, intentTargets, intentUnknownReasons } from "@raiquora/trip/conversation-intent";
import { ConversationModelError } from "../../ports/conversation-model.js";

export type SemanticInterpretationContractFailure =
  | "provider_message"
  | "json_parse"
  | "root_shape"
  | "operation_shape"
  | "value_shape"
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
  const fenced = /^\`\`\`(?:json)?\s*([\s\S]*?)\s*\`\`\`$/u.exec(trimmed);
  if (!fenced) throw new SemanticInterpretationContractError("json_parse");
  const parsed = parseJson(fenced[1]!);
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
    if (operation.value !== undefined && !validValue(operation.value) ||
        ["set", "add_alternative", "replace"].includes(action) && operation.value === undefined ||
        action === "retract" && operation.value !== undefined) return "value_shape";
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

function validValue(value: unknown): boolean {
  if (!record(value) || typeof value.kind !== "string") return false;
  if (value.kind === "text") return only(value, ["kind", "text"]) && boundedText(value.text);
  if (value.kind === "place_label") return only(value, ["kind", "label"]) && boundedText(value.label);
  if (value.kind === "relative_date") return only(value, ["kind", "relation"]) &&
    ["today", "tomorrow", "day_after_tomorrow"].includes(String(value.relation));
  if (value.kind === "month_offset") return only(value, ["kind", "offset"]) &&
    Number.isSafeInteger(value.offset) && Number(value.offset) >= -12 && Number(value.offset) <= 24;
  if (value.kind === "relative_weekday") return only(value, ["kind", "weekday", "direction"]) &&
    Number.isSafeInteger(value.weekday) && Number(value.weekday) >= 1 && Number(value.weekday) <= 7 &&
    ["next", "on_or_after"].includes(String(value.direction));
  if (value.kind === "local_date") return only(value, ["kind", "date"]) && validDate(value.date);
  if (value.kind === "quantity") return only(value, ["kind", "amount", "unit"]) &&
    Number.isSafeInteger(value.amount) && Number(value.amount) >= 0 &&
    ["nights", "days", "people"].includes(String(value.unit));
  if (value.kind === "quantity_range") return only(value, ["kind", "minimum", "maximum", "unit"]) &&
    Number.isSafeInteger(value.minimum) && Number(value.minimum) >= 0 &&
    Number.isSafeInteger(value.maximum) && Number(value.maximum) >= 0 &&
    ["nights", "days", "people"].includes(String(value.unit));
  if (value.kind === "money") return only(value, ["kind", "amount", "currency", "basis"]) &&
    typeof value.amount === "number" && Number.isFinite(value.amount) && value.amount >= 0 &&
    (value.currency === undefined || typeof value.currency === "string" && /^[A-Z]{3}$/u.test(value.currency)) &&
    (value.basis === undefined || ["trip", "per_person", "per_night", "per_room"].includes(String(value.basis)));
  if (value.kind === "presentation_ordinal") return only(value, ["kind", "ordinal"]) &&
    Number.isSafeInteger(value.ordinal) && Number(value.ordinal) >= 1 && Number(value.ordinal) <= 24;
  if (value.kind === "unknown") return only(value, ["kind", "reason"]) &&
    intentUnknownReasons.includes(value.reason as never);
  return false;
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
