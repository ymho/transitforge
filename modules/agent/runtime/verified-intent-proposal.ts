import type { EffectiveIntent } from "./effective-intent";
import type { IntentApplicationReceipt } from "./conversation-intent-reducer";
import { applyTripProposal, type Trip, type TripUpdateProposal } from "@raiquora/trip/trip";
import type { IntentProposalBinding } from "@raiquora/trip/intent-proposal-binding";
import type { ConversationIntentFact, IntentScope, IntentTarget } from "@raiquora/trip/conversation-intent";
import type { ConstraintScope, TripConstraint, TripRequest } from "@raiquora/trip/trip-request";
import { currencyMinorUnits, type CurrencyCode } from "@raiquora/trip/money";

/** Deterministic Application projection. It consumes only the verified receipt
 * and EffectiveIntent; raw model Tool input cannot mint user authority. */
export function proposeVerifiedIntentRequest(input: {
  conversationId: string;
  trip: Trip;
  effectiveIntent: EffectiveIntent;
  receipt: IntentApplicationReceipt;
}): TripUpdateProposal | undefined {
  const { trip, effectiveIntent, receipt } = input;
  if (receipt.intentRevision !== effectiveIntent.intentRevision || receipt.replayed) return undefined;
  const accepted = receipt.operations.filter((operation) => operation.status === "accepted" && operation.frame === "actual");
  if (!accepted.length) return undefined;
  const acceptedSlots = new Set(accepted.map(slotOf));
  const relevantFacts = effectiveIntent.actualConversationFacts.filter((fact) => acceptedSlots.has(slotOf(fact)));
  const projected = projectFacts(relevantFacts);
  const supportedSlots = new Set(projected.flatMap((constraint) => constraint.semantic!.facts.map(slotOf)));
  const removalSlots = new Set([...supportedSlots, ...accepted.filter(({ action }) => action === "retract").map(slotOf),
    ...relevantFacts.filter(({ value }) => value.kind === "unknown").map(slotOf)]);
  const removableTargets = new Set(accepted.filter((operation) => removalSlots.has(slotOf(operation))).map(({ target }) => target));
  const suppressed = new Set(effectiveIntent.suppressedBaseRefs.map((ref) => ref.replace(/^constraint:/u, "")));
  let constraints = trip.request.constraints.filter((constraint) => !(suppressed.has(constraint.id) && removableTargets.has(targetOf(constraint)!)) &&
    !(constraint.semantic?.facts.some((fact) => removalSlots.has(slotOf(fact)))));
  const boundChanges = accepted.filter((operation) => supportedSlots.has(slotOf(operation)) || removalSlots.has(slotOf(operation)) && (
    trip.request.constraints.some((constraint) => constraint.semantic?.facts.some((fact) => slotOf(fact) === slotOf(operation))) ||
    effectiveIntent.suppressedBaseRefs.some((ref) => trip.request.constraints.some((constraint) => `constraint:${constraint.id}` === ref && targetOf(constraint) === operation.target))));
  if (!boundChanges.length) return undefined;
  constraints = [...constraints, ...projected];
  const request: TripRequest = { ...trip.request, constraints };
  const intentBinding: IntentProposalBinding = {
    version: "intent-proposal-binding-v1",
    conversationId: input.conversationId,
    intentRevision: receipt.intentRevision,
    effectiveIntentFingerprint: effectiveIntent.fingerprint,
    changes: boundChanges.map(({ operationId, groupId, action, target, scope }) => ({ changeRef: operationId, groupRef: groupId, action, target, scope: structuredClone(scope) })),
  };
  const proposal: TripUpdateProposal = { tripId: trip.id, baseRevision: trip.revision,
    summary: "会話で受理した今回の条件を反映する変更案", patches: [{ type: "request", request }], intentBinding };
  applyTripProposal(trip, proposal);
  return structuredClone(proposal);
}

function projectFacts(facts: readonly ConversationIntentFact[]): TripConstraint[] {
  const constraints: TripConstraint[] = [];
  const dates = facts.filter((fact) => ["start_date", "end_date"].includes(fact.target) && fact.value.kind === "local_date");
  const start = dates.find(({ target }) => target === "start_date");
  const end = dates.find(({ target }) => target === "end_date");
  if (start) constraints.push(constraint([start], { type: "dates", start: { earliest: start.value.kind === "local_date" ? start.value.date : "", latest: start.value.kind === "local_date" ? start.value.date : "" },
    ...(end?.value.kind === "local_date" ? { end: { earliest: end.value.date, latest: end.value.date } } : {}) }));
  const destinations = facts.filter((fact) => fact.target === "destination" && fact.value.kind === "place_label");
  if (destinations.length) constraints.push(constraint(destinations, { type: "destinations", places: destinations.map((fact) => ({ name: fact.value.kind === "place_label" ? fact.value.label : "", sources: [] })), order: "flexible" }));
  for (const fact of facts) {
    if (dates.includes(fact) || destinations.includes(fact) || fact.value.kind === "unknown") continue;
    if (fact.target === "origin" && fact.value.kind === "place_label") constraints.push(constraint([fact], { type: "origin", place: { name: fact.value.label, sources: [] } }));
    else if (fact.target === "duration" && fact.value.kind === "quantity" && fact.value.unit !== "people") constraints.push(constraint([fact], { type: "duration", unit: fact.value.unit, minimum: fact.value.amount, maximum: fact.value.amount }));
    else if (fact.target === "duration" && fact.value.kind === "quantity_range" && fact.value.unit !== "people") constraints.push(constraint([fact], { type: "duration", unit: fact.value.unit, minimum: fact.value.minimum, maximum: fact.value.maximum }));
    else if (fact.target === "budget" && fact.value.kind === "money" && isCurrency(fact.value.currency)) {
      const digits = currencyMinorUnits[fact.value.currency];
      const factor = 10 ** digits;
      if (Number.isSafeInteger(fact.value.amount * factor)) constraints.push(constraint([fact], { type: "budget", limit: { amountMinor: fact.value.amount * factor, currency: fact.value.currency }, basis: fact.value.basis === "per_person" ? "per-person" : "trip" }));
    } else if (["experience", "accommodation"].includes(fact.target) && fact.value.kind === "text") constraints.push(constraint([fact], {
      type: "experience", intent: fact.modality === "required" ? "must" : ["avoid", "forbidden"].includes(fact.modality) ? "avoid" : "prefer", text: fact.value.text,
    }));
  }
  return constraints;
}

function constraint(facts: readonly ConversationIntentFact[], requirement: TripConstraint["requirement"]): TripConstraint {
  const primary = facts[0]!;
  return {
    id: `intent:${primary.factId}`, source: "user",
    strength: facts.some(({ modality }) => modality === "required" || modality === "forbidden") ? "hard" : "soft",
    scope: requestScope(primary.scope), requirement,
    semantic: { version: 1, facts: facts.map(({ factId, sourceOperationId, target, scope, modality, precision }) => ({ factRef: factId, sourceOperationId, target, scope: structuredClone(scope), modality, precision })) },
  };
}

function requestScope(scope: IntentScope): ConstraintScope {
  if (scope.type === "logical_day") return { type: "logical-day", logicalDayId: scope.logicalDayId };
  if (scope.type === "segment") return { type: "segment", segmentId: scope.segmentId };
  if (scope.type === "participant") return { type: "trip", participantIds: [scope.participantId] };
  return { type: "trip" };
}
function slotOf(value: { target: IntentTarget; scope: IntentScope }): string { return `${value.target}:${JSON.stringify(value.scope)}`; }
function targetOf(constraint: TripConstraint): IntentTarget | undefined {
  if (constraint.semantic?.facts[0]) return constraint.semantic.facts[0].target;
  switch (constraint.requirement.type) {
    case "origin": return "origin";
    case "destinations": return "destination";
    case "dates": return "start_date";
    case "duration": return "duration";
    case "budget": return "budget";
    case "experience": case "adventure": return "experience";
    case "pace": return "pace";
    case "mobility": case "aggregate_metric": case "relative_distance": return "transport";
    case "depart_after": case "arrive_by": return "fixed_schedule";
  }
}
function isCurrency(value: string | undefined): value is CurrencyCode { return value !== undefined && Object.hasOwn(currencyMinorUnits, value); }
