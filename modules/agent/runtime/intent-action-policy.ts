import type { EffectiveIntent } from "./effective-intent";
import type { AgentToolDescriptor, AgentToolError, AgentToolIntentRequirement } from "./tool-contract";
import type { ConversationIntentFact, IntentTarget, IntentValue } from "@raiquora/trip/conversation-intent";
import type { Evidence } from "./evidence-model";

export interface ToolIntentPolicyDecision {
  accepted: boolean;
  dependencyTargets: IntentTarget[];
  error?: AgentToolError;
  /** Closed metadata for the SDK; never echo input values or raw error text. */
  recovery?: { kind: "resolve_conditions"; target: IntentTarget; inputField: string;
    reason: "missing_input" | "not_accepted" | "unknown" | "insufficient_precision" | "stale_value" };
}

/** Validates model Tool input against the same Application-derived meaning projection
 * used for answers. It does not resolve places or manufacture missing values. */
export function validateToolIntentUse(
  descriptor: AgentToolDescriptor,
  input: Record<string, unknown>,
  effective: EffectiveIntent | undefined,
): ToolIntentPolicyDecision {
  const dependencies = descriptor.intentPolicy?.dependencies ?? [];
  if (!effective || !descriptor.intentPolicy) return { accepted: true, dependencyTargets: [...dependencies] };
  // Rollout compatibility: before the semantic acceptance gate has produced a
  // receipt, an empty projection cannot validate or contradict this turn.
  if (effective.intentRevision === 0 && effective.activeBaseFacts.length === 0 &&
      effective.actualConversationFacts.length === 0 && !effective.activeBaseGoal && !effective.activeBaseParty) {
    return { accepted: true, dependencyTargets: [...dependencies] };
  }
  for (const requirement of descriptor.intentPolicy.requirements ?? []) {
    const inputPresent = input[requirement.inputField] !== undefined;
    if (!inputPresent && requirement.necessity === "optional") continue;
    if (!inputPresent) return reject("precondition_missing",
      `Tool入力${requirement.inputField}がありません`, requirement, "missing_input");
    const facts = effective.actualConversationFacts.filter(({ target }) => target === requirement.target);
    const usable = facts.filter((fact) => usableFact(fact, requirement));
    const basePresent = effective.activeBaseFacts.some(({ target }) => target === requirement.target) ||
      requirement.target === "goal" && effective.activeBaseGoal !== undefined ||
      requirement.target === "party_size" && effective.activeBaseParty !== undefined;
    if (facts.some(({ value }) => value.kind === "unknown")) return reject("precondition_missing",
      `Tool入力${requirement.inputField}は利用者が未定・非開示とした${requirement.target}から補完できません`, requirement, "unknown");
    if (requirement.necessity === "required" && !usable.length && !basePresent) return reject("precondition_missing",
      `Tool入力${requirement.inputField}に必要な${requirement.target}が現在の意味状態にありません`, requirement, "not_accepted");
    if (inputPresent && facts.length && !usable.length) return reject("precondition_failed",
      `Tool入力${requirement.inputField}に使える精度または強さの${requirement.target}がありません`, requirement, "insufficient_precision");
    if (inputPresent && requirement.match === "exact" && usable.length && !usable.some(({ value }) => matchesInput(value, input[requirement.inputField]))) {
      return reject("stale_revision", `Tool入力${requirement.inputField}が現在の${requirement.target}と一致しません`, requirement, "stale_value");
    }
  }
  return { accepted: true, dependencyTargets: [...dependencies] };
}

/** Retains evidence whose declared semantic inputs are unaffected. Legacy evidence
 * has no reviewable dependency and is conservatively invalidated on a meaning change. */
export function evidenceForCurrentIntent(
  evidence: readonly Evidence[],
  effective: EffectiveIntent | undefined,
  changedTargets: readonly IntentTarget[],
): Evidence[] {
  if (!effective || changedTargets.length === 0) return evidence.map((item) => structuredClone(item));
  const changed = new Set(changedTargets);
  return evidence.filter((item) => item.intentDependency !== undefined &&
    !item.intentDependency.targets.some((target) => changed.has(target)))
    .map((item) => structuredClone(item));
}

function usableFact(fact: ConversationIntentFact, requirement: AgentToolIntentRequirement): boolean {
  return fact.value.kind !== "unknown" &&
    (requirement.acceptedPrecisions === undefined || requirement.acceptedPrecisions.includes(fact.precision)) &&
    (requirement.acceptedModalities === undefined || requirement.acceptedModalities.includes(fact.modality));
}

function matchesInput(value: IntentValue, input: unknown): boolean {
  if (value.kind === "local_date") return input === value.date;
  if (value.kind === "place_label") return input === value.label;
  if (value.kind === "quantity") return input === value.amount;
  if (value.kind === "party") return typeof input === "number" && input === value.adults + value.children.length;
  if (value.kind === "money") return input === value.amount;
  if (value.kind === "text") return input === value.text;
  if (value.kind === "candidate_ref") return input === value.candidateRef;
  return false;
}

function reject(code: "precondition_missing" | "precondition_failed" | "stale_revision", message: string,
  requirement: AgentToolIntentRequirement, reason: NonNullable<ToolIntentPolicyDecision["recovery"]>["reason"]): ToolIntentPolicyDecision {
  return { accepted: false, dependencyTargets: [], error: { code, message, retryable: false },
    recovery: { kind: "resolve_conditions", target: requirement.target, inputField: requirement.inputField, reason } };
}
