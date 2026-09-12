import type { ChildAgeGroup, TravelCompanion } from "./travel-profile";
import { exactKeys } from "./snapshot-validation";

/** This trip's anonymous party, not profile tendencies, provider input or sharing identities. */
export interface TripParty {
  readonly adults: number;
  readonly children: readonly { readonly ageGroup?: ChildAgeGroup; readonly age?: number }[];
  readonly composition?: readonly TravelCompanion[];
  readonly source: "user" | "profile" | "legacy" | "assumption";
  readonly assumptionId?: string;
}
const companions: readonly TravelCompanion[] = ["solo", "partner", "friends", "children", "family"];
const ageGroups: readonly ChildAgeGroup[] = ["baby", "preschool", "elementary", "teen"];
export function validatePartyComposition(value: readonly TravelCompanion[]): void {
  if (!Array.isArray(value) || value.some((v) => !companions.includes(v)) || new Set(value).size !== value.length) throw new Error("Invalid party composition");
}
export function validateTripParty(party: TripParty): void {
  exactKeys(party, ["adults", "children", "composition", "source", "assumptionId"]);
  if (!Number.isSafeInteger(party.adults) || party.adults < 0 || !Array.isArray(party.children) ||
      !Number.isSafeInteger(party.adults + party.children.length) || party.adults + party.children.length === 0) throw new Error("Invalid party count");
  for (const child of party.children) {
    exactKeys(child, ["age", "ageGroup"]);
    if (child.age !== undefined && (!Number.isSafeInteger(child.age) || child.age < 0)) throw new Error("Invalid child age");
    if (child.ageGroup !== undefined && !ageGroups.includes(child.ageGroup)) throw new Error("Invalid child age group");
  }
  if (party.composition !== undefined) {
    validatePartyComposition(party.composition);
    if (party.composition.includes("solo") && party.adults + party.children.length > 1) throw new Error("Solo contradicts party size");
  }
  if (!["user", "profile", "legacy", "assumption"].includes(party.source) ||
      (party.assumptionId !== undefined && (typeof party.assumptionId !== "string" || !party.assumptionId.trim())) ||
      (party.source !== "user" && !party.assumptionId) || (party.source === "user" && party.assumptionId !== undefined)) throw new Error("Invalid party source/assumption");
}

/** Ignore provenance/key order when checking whether rejection actually changed the party. */
export function samePartyValue(left: TripParty | undefined, right: TripParty | undefined): boolean {
  if (!left || !right) return left === right;
  const value = (p: TripParty) => JSON.stringify([p.adults,
    p.children.map((c) => JSON.stringify([c.age ?? null, c.ageGroup ?? null])).sort(), [...(p.composition ?? [])].sort()]);
  return value(left) === value(right);
}
