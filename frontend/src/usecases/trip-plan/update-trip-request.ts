import { applyTripProposal, type Trip, type TripUpdateProposal, type TripPatch } from "@raiquora/trip/trip";
import { type TripRequest } from "@raiquora/trip/trip-request";
import { proposeModelRequest } from "@raiquora/trip/model-request-proposal";
import type { TripParty } from "@raiquora/trip/trip-party";

/** Model output is only a proposal. New model interpretations must be linked, unconfirmed assumptions. */
export function proposeTripRequestUpdate(trip: Trip, request: TripRequest, actor: "user" | "model"): TripUpdateProposal {
  if (actor !== "user" && actor !== "model") throw new Error("Unknown request actor");
  if (actor === "model") return proposeModelRequest(trip, request);
  return checkedProposal(trip, "今回の旅行条件を更新", [{ type: "request", request }]);
}

/** User-initiated action; linked items requiring repair must be supplied as explicit replacement previews. */
export function proposeAssumptionDecision(trip: Trip, assumptionId: string, status: "confirmed" | "rejected",
  repairs: readonly Extract<TripPatch, { type: "replace" }>[] = [],
  partyRepair?: { type: "remove" } | { type: "replace"; party: TripParty }): TripUpdateProposal {
  if (status !== "confirmed" && status !== "rejected") throw new Error("Invalid assumption decision");
  if (partyRepair && partyRepair.type !== "remove" && partyRepair.type !== "replace") throw new Error("Invalid party repair");
  const current = trip.request.assumptions.find(({ id }) => id === assumptionId);
  if (!current || (current.status !== "unconfirmed" && current.status !== status)) throw new Error("Assumption is missing or already resolved differently");
  if (repairs.some((patch) => !current.affects.some((ref) => ref.type === "item" && ref.itemId === patch.itemId))) throw new Error("Unrelated assumption repair");
  if (partyRepair && (status !== "rejected" || !current.affects.some((ref) => ref.type === "party"))) throw new Error("Unrelated party repair");
  if (partyRepair?.type === "replace" && (partyRepair.party.source !== "user" || partyRepair.party.assumptionId !== undefined)) throw new Error("Replacement party requires explicit user values");
  if (partyRepair && current.status === status) {
    const target = partyRepair.type === "remove" ? undefined : partyRepair.party;
    if (JSON.stringify(target) !== JSON.stringify(trip.request.party)) throw new Error("Retry cannot change resolved party");
  }
  const request: TripRequest = { ...trip.request,
    ...(partyRepair ? { party: partyRepair.type === "remove" ? undefined : partyRepair.party } : {}),
    assumptions: trip.request.assumptions.map((a) => a.id === assumptionId ? { ...a, status } : a) };
  // Constraint references and their original source/strength remain: status controls applicability.
  return checkedProposal(trip, status === "confirmed" ? "仮定を確認" : "仮定を却下", [{ type: "request", request }, ...repairs]);
}

/** Trusted user action, not a model actor flag. Prior profile hypotheses cannot override this trip. */
export function proposeUserParty(trip: Trip, party: Omit<TripParty, "source" | "assumptionId">): TripUpdateProposal {
  const request: TripRequest = { ...trip.request, party: { ...party, source: "user" }, assumptions: trip.request.assumptions.map((a) => {
    if (!a.affects.some((ref) => ref.type === "party") || a.status === "rejected") return a;
    // Confirmation history remains; the old hypothesis no longer supports the replacement.
    return { ...a, ...(a.status === "unconfirmed" && a.affects.every((ref) => ref.type === "party") ? { status: "rejected" as const } : {}),
      affects: a.affects.filter((ref) => ref.type !== "party") };
  }) };
  return proposeTripRequestUpdate(trip, request, "user");
}

/** Profile V3 remains a reference-only recommendation hint. Trip-specific party,
 * mobility and constraints are captured from the current conversation instead of copied
 * from account defaults. */
function checkedProposal(trip: Trip, summary: string, patches: readonly TripPatch[]): TripUpdateProposal {
  const proposal = { tripId: trip.id, baseRevision: trip.revision, summary, patches };
  applyTripProposal(trip, proposal); // Validation only; no persistence or mutation.
  return structuredClone(proposal);
}
