import { intentSpeechActs, intentTargets, type IntentOperationKind, type IntentSpeechAct, type IntentTarget } from "@raiquora/trip/conversation-intent";
import type { IntentApplicationReceipt } from "./conversation-intent-reducer";

export interface PublicSemanticReceipt {
  version: "public-semantic-receipt-v1";
  intentRevision: number;
  speechAct: IntentSpeechAct;
  outcome: "accepted" | "partial" | "unchanged";
  changes: Array<{
    changeRef: string;
    groupRef: string;
    action: IntentOperationKind;
    target: IntentTarget;
    scope: PublicSemanticScope;
    frame: "actual" | "hypothetical";
    status: "accepted" | "rejected";
  }>;
}

/** Public status only: no values, quotes, Profile, Evidence, Tool data or trace. */
export function publicSemanticReceipt(receipt: IntentApplicationReceipt): PublicSemanticReceipt {
  const accepted = receipt.operations.filter(({ status }) => status === "accepted").length;
  return parsePublicSemanticReceipt({ version: "public-semantic-receipt-v1", intentRevision: receipt.intentRevision,
    speechAct: receipt.speechAct, outcome: accepted === 0 ? "unchanged" : accepted === receipt.operations.length ? "accepted" : "partial",
    changes: receipt.operations.map((operation) => ({ changeRef: operation.operationId, groupRef: operation.groupId,
      action: operation.action, target: operation.target, scope: publicScope(operation.scope), frame: operation.frame, status: operation.status })) });
}

export function parsePublicSemanticReceipt(value: unknown): PublicSemanticReceipt {
  if (!record(value) || only(value, ["version", "intentRevision", "speechAct", "outcome", "changes"]) === false ||
      value.version !== "public-semantic-receipt-v1" || !Number.isSafeInteger(value.intentRevision) || Number(value.intentRevision) < 0 ||
      !intentSpeechActs.includes(value.speechAct as IntentSpeechAct) || !["accepted", "partial", "unchanged"].includes(String(value.outcome)) ||
      !Array.isArray(value.changes) || value.changes.length > 12) throw new Error("Invalid public semantic receipt");
  const changes = value.changes.map((change) => {
    if (!record(change) || !only(change, ["changeRef", "groupRef", "action", "target", "scope", "frame", "status"]) ||
        !reference(change.changeRef) || !reference(change.groupRef) || !["set", "add_alternative", "replace", "retract", "relax", "narrow"].includes(String(change.action)) ||
        !intentTargets.includes(change.target as IntentTarget) || !["actual", "hypothetical"].includes(String(change.frame)) ||
        !["accepted", "rejected"].includes(String(change.status))) throw new Error("Invalid public semantic change");
    return { changeRef: change.changeRef, groupRef: change.groupRef, action: change.action as IntentOperationKind, target: change.target as IntentTarget,
      scope: publicScope(parsePublicScope(change.scope)), frame: change.frame as "actual" | "hypothetical", status: change.status as "accepted" | "rejected" };
  });
  return structuredClone({ version: value.version, intentRevision: value.intentRevision, speechAct: value.speechAct, outcome: value.outcome, changes }) as PublicSemanticReceipt;
}

export interface PublicSemanticScope { type: "conversation" | "trip" | "logical_day" | "segment" | "participant" }
function publicScope(scope: { type: PublicSemanticScope["type"] }): PublicSemanticScope {
  return { type: scope.type };
}
function parsePublicScope(value: unknown): PublicSemanticScope {
  if (!record(value) || !only(value, ["type"]) || !["conversation", "trip", "logical_day", "segment", "participant"].includes(String(value.type))) throw new Error("Invalid public semantic scope");
  return { type: value.type as PublicSemanticScope["type"] };
}
function record(value: unknown): value is Record<string, any> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function only(value: Record<string, unknown>, keys: string[]): boolean { const allowed = new Set(keys); return Object.keys(value).every((key) => allowed.has(key)); }
function reference(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f]/u.test(value); }
