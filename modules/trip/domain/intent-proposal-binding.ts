import { parseIntentScope, type IntentScope } from "./conversation-intent";
import { exactKeys } from "./snapshot-validation";

/** Application-authored proof that a reviewable proposal came from an accepted
 * conversation delta. Models cannot provide this field through Tool schemas. */
export interface IntentProposalBinding {
  readonly version: "intent-proposal-binding-v1";
  readonly conversationId: string;
  readonly intentRevision: number;
  readonly effectiveIntentFingerprint: string;
  readonly changes: readonly {
    readonly changeRef: string;
    readonly groupRef: string;
    readonly action: "set" | "add_alternative" | "replace" | "retract" | "relax" | "narrow";
    readonly target: import("./conversation-intent").IntentTarget;
    readonly scope: IntentScope;
  }[];
}

export function parseIntentProposalBinding(value: unknown): IntentProposalBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid intent proposal binding");
  const binding = value as Record<string, unknown>;
  exactKeys(binding, ["version", "conversationId", "intentRevision", "effectiveIntentFingerprint", "changes"]);
  if (binding.version !== "intent-proposal-binding-v1" || !reference(binding.conversationId) ||
      !Number.isSafeInteger(binding.intentRevision) || Number(binding.intentRevision) < 1 ||
      typeof binding.effectiveIntentFingerprint !== "string" || !/^intent-[0-9a-f]{8}$/u.test(binding.effectiveIntentFingerprint) ||
      !Array.isArray(binding.changes) || binding.changes.length < 1 || binding.changes.length > 12) throw new Error("Invalid intent proposal binding");
  const changes = binding.changes.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid intent proposal change");
    const change = value as Record<string, unknown>;
    exactKeys(change, ["changeRef", "groupRef", "action", "target", "scope"]);
    if (!reference(change.changeRef) || !reference(change.groupRef) ||
        !["set", "add_alternative", "replace", "retract", "relax", "narrow"].includes(String(change.action)) ||
        !["goal", "origin", "destination", "start_date", "end_date", "duration", "party_size", "budget", "experience", "pace", "accommodation", "transport", "fixed_schedule", "candidate_selection"].includes(String(change.target))) {
      throw new Error("Invalid intent proposal change");
    }
    return { ...change, scope: parseIntentScope(change.scope) } as IntentProposalBinding["changes"][number];
  });
  if (new Set(changes.map(({ changeRef }) => changeRef)).size !== changes.length) throw new Error("Duplicate intent proposal change");
  return structuredClone({ ...binding, changes }) as unknown as IntentProposalBinding;
}

function reference(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f]/u.test(value);
}
