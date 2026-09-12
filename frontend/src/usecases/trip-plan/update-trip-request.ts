import { applyTripProposal, type Trip, type TripUpdateProposal, type TripPatch } from "@raiquora/trip/trip";
import { type TripRequest, type PlanAssumption, type TripConstraint } from "@raiquora/trip/trip-request";
import { travelPreferenceLabels, type UserProfile, type TravelPreference } from "@raiquora/trip/travel-profile";
import type { PlaceSnapshot } from "@raiquora/trip/place-snapshot";
import type { TripParty } from "@raiquora/trip/trip-party";

/** Model output is only a proposal. New model interpretations must be linked, unconfirmed assumptions. */
export function proposeTripRequestUpdate(trip: Trip, request: TripRequest, actor: "user" | "model"): TripUpdateProposal {
  if (actor !== "user" && actor !== "model") throw new Error("Unknown request actor");
  if (actor === "model") {
    if (JSON.stringify(request.party) !== JSON.stringify(trip.request.party)) {
      if (trip.request.party) throw new Error("Model cannot rewrite known party");
      const a = request.assumptions.find((a) => a.id === request.party?.assumptionId);
      if (request.party?.source !== "assumption" || a?.source !== "model" || a.status !== "unconfirmed") throw new Error("Model party must be an unconfirmed assumption");
    }
    for (const c of trip.request.constraints) {
      if (!request.constraints.some((next) => JSON.stringify(c) === JSON.stringify(next))) throw new Error("Model cannot rewrite existing constraints");
    }
    for (const a of trip.request.assumptions) {
      if (!request.assumptions.some((next) => JSON.stringify(a) === JSON.stringify(next))) throw new Error("Model cannot confirm/reject existing assumptions");
    }
    for (const c of request.constraints.filter((c) => !trip.request.constraints.some(({ id }) => id === c.id))) {
      const a = request.assumptions.find(({ id }) => id === c.assumptionId);
      if (c.source !== "assumption" || a?.source !== "model" || a.status !== "unconfirmed") throw new Error("Model interpretation is not a user fact");
      for (const place of requirementPlaces(c.requirement)) {
        const nameOnly = Object.keys(place).every((key) => ["name", "ref", "sources"].includes(key)) &&
          (!place.ref || place.ref.provider === "manual") && place.sources.length === 0;
        if (!nameOnly && !adoptedPlaces(trip).some((known) => JSON.stringify(known) === JSON.stringify(place))) {
          throw new Error("New provider/place facts require trusted resolution, not model-authored evidence");
        }
      }
    }
    for (const a of request.assumptions.filter((a) => !trip.request.assumptions.some(({ id }) => id === a.id))) {
      if (a.source !== "model" || a.status !== "unconfirmed") throw new Error("Model assumption must be unconfirmed");
    }
    if (request.goal !== trip.request.goal) throw new Error("Model goal changes need explicit user adoption");
  }
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

/** Counts are explicitly supplied; profile companion labels never imply adult counts. */
export function proposeProfileParty(trip: Trip, profile: UserProfile, adults: number, assumptionId: string): TripUpdateProposal {
  if (trip.request.party) throw new Error("Profile cannot override this trip's known party");
  const party: TripParty = { adults, children: profile.companions.children.map(({ ageGroup }) => ({ ageGroup })),
    composition: [...profile.companions.usual], source: "profile", assumptionId };
  return checkedProposal(trip, "普段の同行傾向を仮置き", [{ type: "request", request: { ...trip.request, party,
    assumptions: [...trip.request.assumptions, { id: assumptionId, text: "普段の同行傾向を今回も使う仮定（人数・年齢区分は要確認）", source: "profile", status: "unconfirmed", affects: [{ type: "party" }] }],
  } }]);
}

/** Select individual profile facts, never copy the profile as this trip's request. */
export function proposeProfilePreference(trip: Trip, profile: UserProfile,
  choice: { field: "pace" | "carAvailable" | "maxTravelMinutes" } | { field: "interest"; preference: TravelPreference },
  ids: { constraintId: string; assumptionId?: string }): TripUpdateProposal {
  let requirement: TripConstraint["requirement"];
  switch (choice.field) {
    case "pace": requirement = { type: "pace", value: profile.travelStyle.pace }; break;
    case "carAvailable": requirement = { type: "mobility", carAvailable: profile.home.carAvailable }; break;
    case "maxTravelMinutes":
      if (profile.transport.maxTypicalTravelMinutes === null) throw new Error("Profile travel limit is unknown");
      requirement = { type: "mobility", maxTravelMinutes: profile.transport.maxTypicalTravelMinutes }; break;
    case "interest": requirement = { type: "experience", intent: "prefer", text: travelPreferenceLabels[choice.preference],
      preference: choice.preference, weight: profile.preferences[choice.preference] }; break;
    default: throw new Error("Unsupported profile field");
  }
  const constraint: TripConstraint = { id: ids.constraintId, strength: "soft", source: "profile", scope: { type: "trip" }, requirement,
    ...(ids.assumptionId !== undefined ? { assumptionId: ids.assumptionId } : {}) };
  const assumption: PlanAssumption[] = ids.assumptionId === undefined ? [] : [{ id: ids.assumptionId,
    text: "普段の嗜好を今回も利用する仮定", status: "unconfirmed", source: "profile", affects: [{ type: "constraint", constraintId: ids.constraintId }] }];
  return checkedProposal(trip, "プロフィールの一部を今回条件へ採用", [{ type: "request", request: {
    ...trip.request, constraints: [...trip.request.constraints, constraint], assumptions: [...trip.request.assumptions, ...assumption],
  } }]);
}
function checkedProposal(trip: Trip, summary: string, patches: readonly TripPatch[]): TripUpdateProposal {
  const proposal = { tripId: trip.id, summary, patches };
  applyTripProposal(trip, proposal); // Validation only; no persistence or mutation.
  return structuredClone(proposal);
}

function requirementPlaces(requirement: TripConstraint["requirement"]): readonly PlaceSnapshot[] {
  if (requirement.type === "destinations") return requirement.places;
  return "place" in requirement ? [requirement.place] : [];
}
function adoptedPlaces(trip: Trip): readonly PlaceSnapshot[] {
  return [...trip.request.constraints.flatMap((c) => [...requirementPlaces(c.requirement)]), ...trip.items.flatMap((item) => {
    if (item.type === "activity") return item.place ? [item.place] : [];
    if (item.type === "stay") return item.selection.status === "selected" ? [item.selection.accommodation.place] : item.selection.place ? [item.selection.place] : [];
    return item.detail.status === "selected" ? item.detail.journey.legs.flatMap((leg) => [leg.origin, leg.destination]) : [];
  })];
}
