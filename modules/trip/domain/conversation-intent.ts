export const intentTargets = [
  "goal", "origin", "destination", "start_date", "end_date", "duration", "party_size",
  "budget", "experience", "pace", "accommodation", "transport", "fixed_schedule",
] as const;
export type IntentTarget = typeof intentTargets[number];

export const intentModalities = ["required", "preferred", "acceptable", "avoid", "forbidden"] as const;
export type IntentModality = typeof intentModalities[number];
export const intentUnknownReasons = ["unspecified", "undecided", "no_preference", "unknown_to_user", "withheld", "conflicting"] as const;
export type IntentUnknownReason = typeof intentUnknownReasons[number];
export type IntentPrecision = "exact" | "approximate" | "range" | "qualitative";
export type IntentOperationKind = "set" | "add_alternative" | "replace" | "retract" | "relax" | "narrow";

export type IntentScope =
  | { type: "conversation" }
  | { type: "trip"; tripId: string }
  | { type: "logical_day"; logicalDayId: string }
  | { type: "segment"; segmentId: string; direction?: "outbound" | "return" }
  | { type: "participant"; participantId: string };

export type IntentValue =
  | { kind: "text"; text: string }
  | { kind: "place_label"; label: string }
  | { kind: "local_date"; date: string; expression?: "today" | "tomorrow" | "day_after_tomorrow" }
  | { kind: "quantity"; amount: number; unit: "nights" | "days" | "people" }
  | { kind: "quantity_range"; minimum: number; maximum: number; unit: "nights" | "days" | "people" }
  | { kind: "money"; amount: number; currency?: string; basis?: "trip" | "per_person" | "per_night" | "per_room" }
  | { kind: "unknown"; reason: IntentUnknownReason };

export interface AcceptedIntentOperation {
  operationId: string;
  groupId: string;
  action: IntentOperationKind;
  target: IntentTarget;
  scope: IntentScope;
  modality?: IntentModality;
  precision?: IntentPrecision;
  value?: IntentValue;
  frame: "actual" | "hypothetical";
  provenance: { kind: "user_turn" | "ui_action"; turnId: string; quote?: string };
}

export interface AcceptedIntentDelta {
  version: 1;
  mutationId: string;
  baseIntentRevision: number;
  operations: AcceptedIntentOperation[];
}

export interface ConversationIntentFact {
  factId: string;
  target: IntentTarget;
  scope: IntentScope;
  modality: IntentModality;
  precision: IntentPrecision;
  value: IntentValue;
  frame: "actual" | "hypothetical";
  sourceOperationId: string;
  provenance: AcceptedIntentOperation["provenance"];
}

export interface ConversationIntentTombstone {
  tombstoneId: string;
  target: IntentTarget;
  scope: IntentScope;
  sourceOperationId: string;
  reason: IntentUnknownReason | "retracted";
}

export interface ConversationIntentOverlay {
  version: 1;
  intentRevision: number;
  facts: ConversationIntentFact[];
  tombstones: ConversationIntentTombstone[];
  appliedMutationIds: string[];
}

export const conversationIntentLimits = {
  maximumOperations: 12,
  maximumFacts: 48,
  maximumTombstones: 48,
  maximumAppliedMutations: 64,
  maximumTextCharacters: 300,
  maximumBytes: 32_000,
} as const;

export function emptyConversationIntentOverlay(): ConversationIntentOverlay {
  return { version: 1, intentRevision: 0, facts: [], tombstones: [], appliedMutationIds: [] };
}

export function parseAcceptedIntentDelta(value: unknown): AcceptedIntentDelta {
  if (!record(value) || !only(value, ["version", "mutationId", "baseIntentRevision", "operations"]) || value.version !== 1 ||
      !reference(value.mutationId) || !nonnegativeInteger(value.baseIntentRevision) || !Array.isArray(value.operations) ||
      value.operations.length < 1 || value.operations.length > conversationIntentLimits.maximumOperations || encodedBytes(value) > conversationIntentLimits.maximumBytes) {
    throw new Error("Invalid accepted intent delta");
  }
  const operations = value.operations.map(parseOperation);
  if (new Set(operations.map(({ operationId }) => operationId)).size !== operations.length) throw new Error("Duplicate intent operation");
  const groups = new Map<string, Set<string>>();
  for (const operation of operations) {
    const targets = groups.get(operation.groupId) ?? new Set<string>();
    const key = `${operation.target}:${JSON.stringify(operation.scope)}`;
    if (targets.has(key)) throw new Error("Conflicting operations in one atomic group");
    targets.add(key); groups.set(operation.groupId, targets);
  }
  return structuredClone({ version: 1, mutationId: value.mutationId, baseIntentRevision: value.baseIntentRevision, operations });
}

export function parseConversationIntentOverlay(value: unknown): ConversationIntentOverlay {
  if (!record(value) || !only(value, ["version", "intentRevision", "facts", "tombstones", "appliedMutationIds"]) || value.version !== 1 ||
      !nonnegativeInteger(value.intentRevision) || !Array.isArray(value.facts) || value.facts.length > conversationIntentLimits.maximumFacts ||
      !Array.isArray(value.tombstones) || value.tombstones.length > conversationIntentLimits.maximumTombstones ||
      !stringList(value.appliedMutationIds, conversationIntentLimits.maximumAppliedMutations) || encodedBytes(value) > conversationIntentLimits.maximumBytes) {
    throw new Error("Invalid conversation intent overlay");
  }
  const facts = value.facts.map(parseFact), tombstones = value.tombstones.map(parseTombstone);
  unique(facts.map(({ factId }) => factId)); unique(tombstones.map(({ tombstoneId }) => tombstoneId)); unique(value.appliedMutationIds);
  return structuredClone({ version: 1, intentRevision: value.intentRevision, facts, tombstones, appliedMutationIds: value.appliedMutationIds });
}

function parseOperation(value: unknown): AcceptedIntentOperation {
  if (!record(value) || !only(value, ["operationId", "groupId", "action", "target", "scope", "modality", "precision", "value", "frame", "provenance"]) ||
      !reference(value.operationId) || !reference(value.groupId) || !["set", "add_alternative", "replace", "retract", "relax", "narrow"].includes(String(value.action)) ||
      !intentTargets.includes(value.target as IntentTarget) || !["actual", "hypothetical"].includes(String(value.frame))) throw new Error("Invalid intent operation");
  const action = value.action as IntentOperationKind;
  if (["set", "add_alternative", "replace"].includes(action) && value.value === undefined || action === "retract" && value.value !== undefined) throw new Error("Invalid intent operation value");
  if (value.modality !== undefined && !intentModalities.includes(value.modality as IntentModality) ||
      value.precision !== undefined && !["exact", "approximate", "range", "qualitative"].includes(String(value.precision))) throw new Error("Invalid intent operation attributes");
  if (!record(value.provenance) || !only(value.provenance, ["kind", "turnId", "quote"]) || !["user_turn", "ui_action"].includes(String(value.provenance.kind)) ||
      !reference(value.provenance.turnId) || value.provenance.quote !== undefined && !boundedText(value.provenance.quote)) throw new Error("Invalid intent provenance");
  return structuredClone({ ...value, scope: parseIntentScope(value.scope), ...(value.value === undefined ? {} : { value: parseValue(value.value) }) }) as AcceptedIntentOperation;
}

function parseFact(value: unknown): ConversationIntentFact {
  if (!record(value) || !only(value, ["factId", "target", "scope", "modality", "precision", "value", "frame", "sourceOperationId", "provenance"]) ||
      !reference(value.factId) || !intentTargets.includes(value.target as IntentTarget) || !intentModalities.includes(value.modality as IntentModality) ||
      !["exact", "approximate", "range", "qualitative"].includes(String(value.precision)) || !["actual", "hypothetical"].includes(String(value.frame)) ||
      !reference(value.sourceOperationId)) throw new Error("Invalid conversation intent fact");
  const operation = parseOperation({ operationId: value.sourceOperationId, groupId: "stored", action: "set", target: value.target,
    scope: value.scope, modality: value.modality, precision: value.precision, value: value.value, frame: value.frame, provenance: value.provenance });
  return { factId: value.factId, target: operation.target, scope: operation.scope, modality: operation.modality!, precision: operation.precision!,
    value: operation.value!, frame: operation.frame, sourceOperationId: operation.operationId, provenance: operation.provenance };
}

function parseTombstone(value: unknown): ConversationIntentTombstone {
  if (!record(value) || !only(value, ["tombstoneId", "target", "scope", "sourceOperationId", "reason"]) || !reference(value.tombstoneId) ||
      !intentTargets.includes(value.target as IntentTarget) || !reference(value.sourceOperationId) ||
      ![...intentUnknownReasons, "retracted"].includes(value.reason as IntentUnknownReason | "retracted")) throw new Error("Invalid conversation intent tombstone");
  return { tombstoneId: value.tombstoneId, target: value.target as IntentTarget, scope: parseIntentScope(value.scope), sourceOperationId: value.sourceOperationId,
    reason: value.reason as ConversationIntentTombstone["reason"] };
}

export function parseIntentScope(value: unknown): IntentScope {
  if (!record(value) || typeof value.type !== "string") throw new Error("Invalid intent scope");
  if (value.type === "conversation" && only(value, ["type"])) return { type: "conversation" };
  if (value.type === "trip" && only(value, ["type", "tripId"]) && reference(value.tripId)) return { type: "trip", tripId: value.tripId };
  if (value.type === "logical_day" && only(value, ["type", "logicalDayId"]) && reference(value.logicalDayId)) return { type: "logical_day", logicalDayId: value.logicalDayId };
  if (value.type === "segment" && only(value, ["type", "segmentId", "direction"]) && reference(value.segmentId) &&
      (value.direction === undefined || ["outbound", "return"].includes(String(value.direction)))) return { type: "segment", segmentId: value.segmentId,
        ...(value.direction ? { direction: value.direction as "outbound" | "return" } : {}) };
  if (value.type === "participant" && only(value, ["type", "participantId"]) && reference(value.participantId)) return { type: "participant", participantId: value.participantId };
  throw new Error("Invalid intent scope");
}

function parseValue(value: unknown): IntentValue {
  if (!record(value) || typeof value.kind !== "string") throw new Error("Invalid intent value");
  if (value.kind === "text" && only(value, ["kind", "text"]) && boundedText(value.text)) return { kind: "text", text: value.text };
  if (value.kind === "place_label" && only(value, ["kind", "label"]) && boundedText(value.label)) return { kind: "place_label", label: value.label };
  if (value.kind === "local_date" && only(value, ["kind", "date", "expression"]) && validDate(value.date) &&
      (value.expression === undefined || ["today", "tomorrow", "day_after_tomorrow"].includes(String(value.expression)))) return { kind: "local_date", date: value.date,
        ...(value.expression ? { expression: value.expression as "today" | "tomorrow" | "day_after_tomorrow" } : {}) };
  if (value.kind === "quantity" && only(value, ["kind", "amount", "unit"]) && nonnegativeInteger(value.amount) && ["nights", "days", "people"].includes(String(value.unit)))
    return { kind: "quantity", amount: value.amount, unit: value.unit as "nights" | "days" | "people" };
  if (value.kind === "quantity_range" && only(value, ["kind", "minimum", "maximum", "unit"]) && nonnegativeInteger(value.minimum) && nonnegativeInteger(value.maximum) &&
      Number(value.minimum) <= Number(value.maximum) && ["nights", "days", "people"].includes(String(value.unit))) return { kind: "quantity_range", minimum: value.minimum, maximum: value.maximum,
        unit: value.unit as "nights" | "days" | "people" };
  if (value.kind === "money" && only(value, ["kind", "amount", "currency", "basis"]) && finiteNonnegative(value.amount) &&
      (value.currency === undefined || typeof value.currency === "string" && /^[A-Z]{3}$/u.test(value.currency)) &&
      (value.basis === undefined || ["trip", "per_person", "per_night", "per_room"].includes(String(value.basis)))) return { kind: "money", amount: value.amount,
        ...(value.currency ? { currency: value.currency } : {}), ...(value.basis ? { basis: value.basis as "trip" | "per_person" | "per_night" | "per_room" } : {}) };
  if (value.kind === "unknown" && only(value, ["kind", "reason"]) && intentUnknownReasons.includes(value.reason as IntentUnknownReason)) return { kind: "unknown", reason: value.reason as IntentUnknownReason };
  throw new Error("Invalid intent value");
}

function record(value: unknown): value is Record<string, any> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function only(value: Record<string, unknown>, keys: string[]): boolean { const allowed = new Set(keys); return Object.keys(value).every((key) => allowed.has(key)); }
function reference(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f]/u.test(value); }
function boundedText(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= conversationIntentLimits.maximumTextCharacters && !/[\u0000\u007f]/u.test(value); }
function nonnegativeInteger(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0; }
function finiteNonnegative(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function validDate(value: unknown): value is string { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false; const parsed = new Date(`${value}T00:00:00Z`); return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value; }
function stringList(value: unknown, maximum: number): value is string[] { return Array.isArray(value) && value.length <= maximum && value.every(reference); }
function unique(values: readonly string[]): void { if (new Set(values).size !== values.length) throw new Error("Duplicate conversation intent reference"); }
function encodedBytes(value: unknown): number { try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; } catch { return Number.POSITIVE_INFINITY; } }
