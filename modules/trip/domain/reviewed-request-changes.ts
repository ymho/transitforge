import { applyTripProposal, type Trip, type TripUpdateProposal } from "./trip";
import { type TripRequest, type TripRequirement, type PlanAssumption } from "./trip-request";
import { samePartyValue, type TripParty } from "./trip-party";
import { exactKeys } from "./snapshot-validation";
import { validateModelRequirementPlaces } from "./model-request-proposal";

type Change =
  | { type: "replace_constraint"; constraintId: string; requirement: TripRequirement; strength: "hard" | "soft" }
  | { type: "remove_constraint"; constraintId: string }
  | { type: "set_party"; party: Omit<TripParty, "source" | "assumptionId"> }
  | { type: "clear_party" }
  | { type: "set_goal"; goal: string }
  | { type: "clear_goal" };
export type ReviewedRequestChange = Change & { reason: string };

/** An uncommitted diff for explicit user review, never an automatic correction of saved facts. */
export function proposeReviewedRequestChanges(trip: Trip, changes: readonly ReviewedRequestChange[], newAssumptionId: () => string): TripUpdateProposal {
  if (!Array.isArray(changes) || !changes.length || changes.length > 8) throw new Error("Invalid change count");
  let request: TripRequest = structuredClone(trip.request);
  const targets = new Set<string>();
  const detach = (matches: (ref: PlanAssumption["affects"][number]) => boolean) => {
    request = { ...request, assumptions: request.assumptions.map(a => ({ ...a, affects: a.affects.filter(ref => !matches(ref)) })) };
  };
  const assumption = (reason: string, affects: PlanAssumption["affects"]): string => {
    const id = newAssumptionId();
    if (!id || request.assumptions.some(a => a.id === id)) throw new Error("Duplicate assumption ID");
    request = { ...request, assumptions: [...request.assumptions, { id, text: reason, source: "model", status: "unconfirmed", affects }] };
    return id;
  };
  for (const change of changes) {
    if (!change || typeof change.reason !== "string" || !change.reason.trim() || change.reason.length > 240) throw new Error("Missing change reason");
    const target = "constraintId" in change ? `constraint:${change.constraintId}` : change.type.endsWith("party") ? "party" : "goal";
    if (targets.has(target)) throw new Error("Duplicate change target");
    targets.add(target);
    switch (change.type) {
      case "replace_constraint": case "remove_constraint": {
        exactKeys(change, change.type === "replace_constraint" ? ["type", "reason", "constraintId", "requirement", "strength"] : ["type", "reason", "constraintId"]);
        const previous = request.constraints.find(c => c.id === change.constraintId);
        if (!previous || previous.scope.type !== "trip") throw new Error("Unknown or item-scoped condition");
        if (change.type === "replace_constraint") {
          if (previous.requirement.type !== change.requirement?.type) throw new Error("Replacement must preserve the condition kind");
          if (JSON.stringify(previous.requirement) === JSON.stringify(change.requirement) && previous.strength === change.strength) throw new Error("Condition has not changed");
          validateModelRequirementPlaces(trip, change.requirement);
        }
        detach(ref => ref.type === "constraint" && ref.constraintId === previous.id);
        if (change.type === "remove_constraint") request = { ...request, constraints: request.constraints.filter(c => c.id !== previous.id) };
        else {
          const assumptionId = assumption(change.reason, [{ type: "constraint", constraintId: previous.id }]);
          request = { ...request, constraints: request.constraints.map(c => c.id === previous.id
            ? { id: previous.id, scope: previous.scope, source: "assumption", assumptionId, strength: change.strength, requirement: change.requirement } : c) };
        }
        break;
      }
      case "set_party": case "clear_party": {
        exactKeys(change, change.type === "set_party" ? ["type", "reason", "party"] : ["type", "reason"]);
        if (change.type === "clear_party" && !request.party) throw new Error("Party is already unknown");
        if (change.type === "set_party" && samePartyValue(request.party, { ...change.party, source: "user" })) throw new Error("Party has not changed");
        detach(ref => ref.type === "party");
        if (change.type === "clear_party") {
          const { party: _party, ...rest } = request; request = rest;
        } else {
          exactKeys(change.party, ["adults", "children", "composition"]);
          if (change.party.adults > 100 || change.party.children.length > 100) throw new Error("Party too large");
          const assumptionId = assumption(change.reason, [{ type: "party" }]);
          request = { ...request, party: { ...change.party, source: "assumption", assumptionId } };
        }
        break;
      }
      case "set_goal": case "clear_goal": {
        exactKeys(change, change.type === "set_goal" ? ["type", "reason", "goal"] : ["type", "reason"]);
        if (change.type === "clear_goal" && request.goal === undefined || change.type === "set_goal" && change.goal === request.goal) throw new Error("Goal has not changed");
        if (change.type === "set_goal") {
          if (typeof change.goal !== "string" || !change.goal.trim() || change.goal.length > 240) throw new Error("Invalid goal");
          request = { ...request, goal: change.goal };
        } else { const { goal: _goal, ...rest } = request; request = rest; }
        break;
      }
      default: throw new Error("Unknown request change");
    }
  }
  const proposal: TripUpdateProposal = { tripId: trip.id, baseRevision: trip.revision,
    summary: "旅行条件の変更案（確認後に反映）", patches: [{ type: "request", request }] };
  applyTripProposal(trip, proposal);
  return structuredClone(proposal);
}
