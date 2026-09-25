import {
  conversationIntentLimits,
  parseAcceptedIntentDelta,
  parseConversationIntentOverlay,
  parseIntentScope,
  type AcceptedIntentDelta,
  type AcceptedIntentOperation,
  type ConversationIntentFact,
  type ConversationIntentOverlay,
  type IntentModality,
  type IntentOperationKind,
  type IntentScope,
  type IntentSpeechAct,
  type IntentTarget,
} from "@raiquora/trip/conversation-intent";

export type IntentOperationReason = "applied" | "already_applied" | "target_missing" | "invalid_transition" | "capacity_exceeded";
export interface IntentOperationReceipt {
  operationId: string;
  groupId: string;
  action: IntentOperationKind;
  target: IntentTarget;
  scope: IntentScope;
  frame: "actual" | "hypothetical";
  status: "accepted" | "rejected";
  reason: IntentOperationReason;
  beforeFactRefs: string[];
  afterFactRefs: string[];
}
export interface IntentApplicationReceipt {
  version: 1;
  mutationId: string;
  speechAct: IntentSpeechAct;
  beforeIntentRevision: number;
  intentRevision: number;
  replayed: boolean;
  operations: IntentOperationReceipt[];
}
export interface IntentReductionResult { overlay: ConversationIntentOverlay; receipt: IntentApplicationReceipt }

export function parseIntentApplicationReceipt(value: unknown): IntentApplicationReceipt {
  if (!record(value) || !only(value, ["version", "mutationId", "speechAct", "beforeIntentRevision", "intentRevision", "replayed", "operations"]) || value.version !== 1 ||
      !reference(value.mutationId) || !nonnegativeInteger(value.beforeIntentRevision) || !nonnegativeInteger(value.intentRevision) || typeof value.replayed !== "boolean" ||
      !["inform", "correct", "question", "consider", "reject", "confirm", "cancel", "switch_topic"].includes(String(value.speechAct)) ||
      !Array.isArray(value.operations) || value.operations.length > conversationIntentLimits.maximumOperations) throw new Error("Invalid intent application receipt");
  const operations = value.operations.map((item) => {
    if (!record(item) || !only(item, ["operationId", "groupId", "action", "target", "scope", "frame", "status", "reason", "beforeFactRefs", "afterFactRefs"]) || !reference(item.operationId) ||
        !reference(item.groupId) || !["set", "add_alternative", "replace", "retract", "relax", "narrow"].includes(String(item.action)) ||
        !["goal", "origin", "destination", "start_date", "end_date", "duration", "party_size", "budget", "experience", "pace", "accommodation", "transport", "fixed_schedule", "candidate_selection"].includes(String(item.target)) ||
        !["actual", "hypothetical"].includes(String(item.frame)) || !["accepted", "rejected"].includes(String(item.status)) ||
        !["applied", "already_applied", "target_missing", "invalid_transition", "capacity_exceeded"].includes(String(item.reason)) ||
        !referenceList(item.beforeFactRefs) || !referenceList(item.afterFactRefs)) throw new Error("Invalid intent operation receipt");
    return { ...structuredClone(item), scope: parseIntentScope(item.scope) } as IntentOperationReceipt;
  });
  return { version: 1, mutationId: value.mutationId, speechAct: value.speechAct as IntentSpeechAct, beforeIntentRevision: value.beforeIntentRevision, intentRevision: value.intentRevision,
    replayed: value.replayed, operations };
}

/** Pure reducer. Authority, clocks and IDs are validated before this boundary. */
export function reduceConversationIntent(current: ConversationIntentOverlay, candidate: AcceptedIntentDelta): IntentReductionResult {
  const overlay = parseConversationIntentOverlay(current), delta = parseAcceptedIntentDelta(candidate);
  if (delta.baseIntentRevision !== overlay.intentRevision) throw new Error("Intent revision conflict");
  if (overlay.appliedMutationIds.includes(delta.mutationId)) return {
    overlay,
    receipt: { version: 1, mutationId: delta.mutationId, speechAct: delta.speechAct, beforeIntentRevision: overlay.intentRevision,
      intentRevision: overlay.intentRevision, replayed: true, operations: delta.operations.map((operation) => ({ operationId: operation.operationId,
        groupId: operation.groupId, action: operation.action, target: operation.target, scope: structuredClone(operation.scope), frame: operation.frame, status: "accepted", reason: "already_applied", beforeFactRefs: matchingFacts(overlay, operation).map(({ factId }) => factId),
        afterFactRefs: matchingFacts(overlay, operation).map(({ factId }) => factId) })) },
  };

  let next = structuredClone(overlay);
  const receipts: IntentOperationReceipt[] = [];
  for (const operations of grouped(delta.operations)) {
    const simulated = simulateGroup(next, operations);
    if (!simulated.valid) {
      receipts.push(...operations.map((operation): IntentOperationReceipt => ({ operationId: operation.operationId, groupId: operation.groupId,
        action: operation.action, target: operation.target, scope: structuredClone(operation.scope), frame: operation.frame, status: "rejected",
        reason: simulated.reason, beforeFactRefs: matchingFacts(next, operation).map(({ factId }) => factId), afterFactRefs: [] })));
      continue;
    }
    next = simulated.overlay;
    receipts.push(...simulated.receipts);
  }
  next.intentRevision += 1;
  next.appliedMutationIds = [...next.appliedMutationIds, delta.mutationId].slice(-conversationIntentLimits.maximumAppliedMutations);
  next = parseConversationIntentOverlay(next);
  return { overlay: next, receipt: { version: 1, mutationId: delta.mutationId, speechAct: delta.speechAct, beforeIntentRevision: overlay.intentRevision,
    intentRevision: next.intentRevision, replayed: false, operations: receipts } };
}

function simulateGroup(current: ConversationIntentOverlay, operations: AcceptedIntentOperation[]): { valid: true; overlay: ConversationIntentOverlay; receipts: IntentOperationReceipt[] } |
  { valid: false; reason: Exclude<IntentOperationReason, "applied" | "already_applied"> } {
  let overlay = structuredClone(current);
  const receipts: IntentOperationReceipt[] = [];
  for (const operation of operations) {
    const before = matchingFacts(overlay, operation);
    if (["replace", "relax", "narrow"].includes(operation.action) && !before.length) return { valid: false, reason: "target_missing" };
    if (operation.action === "relax" || operation.action === "narrow") {
      const action = operation.action;
      const mapped = before.map((fact) => ({ ...fact, modality: transitionModality(fact.modality, action) }));
      if (mapped.some((fact, index) => fact.modality === before[index]!.modality)) return { valid: false, reason: "invalid_transition" };
      overlay.facts = overlay.facts.map((fact) => mapped.find(({ factId }) => factId === fact.factId) ?? fact);
      receipts.push(receipt(operation, before, mapped));
      continue;
    }
    if (operation.action === "retract") {
      overlay.facts = overlay.facts.filter((fact) => !before.some(({ factId }) => factId === fact.factId));
      overlay.tombstones = [...overlay.tombstones.filter((value) => !sameTargetScope(value, operation)), {
        tombstoneId: boundedRef(`tombstone:${operation.operationId}`), target: operation.target, scope: structuredClone(operation.scope),
        frame: operation.frame, sourceOperationId: operation.operationId, reason: "retracted" as const,
      }];
      if (overlay.tombstones.length > conversationIntentLimits.maximumTombstones) return { valid: false, reason: "capacity_exceeded" };
      receipts.push(receipt(operation, before, []));
      continue;
    }
    const fact = factFromOperation(operation);
    const identical = before.find((value) => sameFactMeaning(value, fact));
    if (operation.action === "add_alternative") {
      if (!identical) overlay.facts.push(fact);
    } else {
      overlay.facts = overlay.facts.filter((value) => !sameTargetScope(value, operation));
      overlay.facts.push(identical ?? fact);
    }
    overlay.tombstones = overlay.tombstones.filter((value) => !sameTargetScope(value, operation));
    if (overlay.facts.length > conversationIntentLimits.maximumFacts) return { valid: false, reason: "capacity_exceeded" };
    receipts.push(receipt(operation, before, matchingFacts(overlay, operation)));
  }
  return { valid: true, overlay, receipts };
}

function factFromOperation(operation: AcceptedIntentOperation): ConversationIntentFact {
  if (!operation.value) throw new Error("Intent value required");
  return { factId: boundedRef(`fact:${operation.operationId}`), target: operation.target, scope: structuredClone(operation.scope),
    modality: operation.modality ?? "preferred", precision: operation.precision ?? defaultPrecision(operation), value: structuredClone(operation.value),
    frame: operation.frame, sourceOperationId: operation.operationId, provenance: structuredClone(operation.provenance) };
}

function defaultPrecision(operation: AcceptedIntentOperation): ConversationIntentFact["precision"] {
  if (operation.value?.kind === "quantity_range") return "range";
  if (operation.value?.kind === "unknown") return "qualitative";
  return "exact";
}

function transitionModality(value: IntentModality, action: "relax" | "narrow"): IntentModality {
  if (action === "relax") {
    if (value === "required" || value === "preferred") return "acceptable";
    if (value === "forbidden") return "avoid";
    return value;
  }
  if (value === "acceptable") return "preferred";
  if (value === "preferred") return "required";
  if (value === "avoid") return "forbidden";
  return value;
}

function grouped(operations: AcceptedIntentOperation[]): AcceptedIntentOperation[][] {
  const groups = new Map<string, AcceptedIntentOperation[]>();
  for (const operation of operations) groups.set(operation.groupId, [...(groups.get(operation.groupId) ?? []), operation]);
  return [...groups.values()];
}

function matchingFacts(overlay: ConversationIntentOverlay, operation: Pick<AcceptedIntentOperation, "target" | "scope" | "frame">): ConversationIntentFact[] {
  return overlay.facts.filter((fact) => sameTargetScope(fact, operation));
}
function sameTargetScope(left: { target: AcceptedIntentOperation["target"]; scope: AcceptedIntentOperation["scope"]; frame: AcceptedIntentOperation["frame"] }, right: { target: AcceptedIntentOperation["target"]; scope: AcceptedIntentOperation["scope"]; frame: AcceptedIntentOperation["frame"] }): boolean {
  return left.target === right.target && left.frame === right.frame && JSON.stringify(left.scope) === JSON.stringify(right.scope);
}
function sameFactMeaning(left: ConversationIntentFact, right: ConversationIntentFact): boolean {
  return sameTargetScope(left, right) && left.modality === right.modality && left.precision === right.precision && left.frame === right.frame && JSON.stringify(left.value) === JSON.stringify(right.value);
}
function receipt(operation: AcceptedIntentOperation, before: ConversationIntentFact[], after: ConversationIntentFact[]): IntentOperationReceipt {
  return { operationId: operation.operationId, groupId: operation.groupId, action: operation.action, target: operation.target,
    scope: structuredClone(operation.scope), frame: operation.frame, status: "accepted", reason: "applied",
    beforeFactRefs: before.map(({ factId }) => factId), afterFactRefs: after.map(({ factId }) => factId) };
}
function boundedRef(value: string): string { return value.length <= 200 ? value : value.slice(0, 200); }
function record(value: unknown): value is Record<string, any> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function only(value: Record<string, unknown>, keys: string[]): boolean { const allowed = new Set(keys); return Object.keys(value).every((key) => allowed.has(key)); }
function reference(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f]/u.test(value); }
function referenceList(value: unknown): value is string[] { return Array.isArray(value) && value.length <= conversationIntentLimits.maximumFacts && value.every(reference); }
function nonnegativeInteger(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0; }
