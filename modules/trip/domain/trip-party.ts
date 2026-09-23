import type { ChildAgeGroup, TravelCompanion } from "./travel-profile";
import { exactKeys } from "./snapshot-validation";

/** This trip's anonymous party, not profile tendencies, provider input or sharing identities. */
export interface TripParty {
  readonly adults: number;
  readonly children: readonly { readonly ageGroup?: ChildAgeGroup; readonly age?: number }[];
  readonly composition?: readonly TravelCompanion[];
  readonly source: "user" | "profile" | "legacy" | "assumption";
  readonly assumptionId?: string;
  /** Optional anonymous within-Trip identities; never account/profile identities. */
  readonly participants?: readonly { readonly id: string; readonly role: "adult" | "child" }[];
}
const companions: readonly TravelCompanion[] = ["solo", "partner", "friends", "children", "family"];
const ageGroups: readonly ChildAgeGroup[] = ["baby", "preschool", "elementary", "teen"];
export function validatePartyComposition(value: readonly TravelCompanion[]): void {
  if (!Array.isArray(value) || value.some((v) => !companions.includes(v)) || new Set(value).size !== value.length) throw new Error("Invalid party composition");
}
export function validateTripParty(party: TripParty): void {
  exactKeys(party, ["adults", "children", "composition", "source", "assumptionId", "participants"]);
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
  if (party.participants !== undefined) {
    if (!Array.isArray(party.participants) || party.participants.length !== party.adults + party.children.length ||
        new Set(party.participants.map(({ id }) => id)).size !== party.participants.length ||
        party.participants.filter(({ role }) => role === "adult").length !== party.adults ||
        party.participants.some(({ id, role }) => typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/u.test(id) || !["adult", "child"].includes(role))) {
      throw new Error("Invalid anonymous participants");
    }
  }
  if (!["user", "profile", "legacy", "assumption"].includes(party.source) ||
      (party.assumptionId !== undefined && (typeof party.assumptionId !== "string" || !party.assumptionId.trim())) ||
      (party.source !== "user" && !party.assumptionId) || (party.source === "user" && party.assumptionId !== undefined)) throw new Error("Invalid party source/assumption");
}

/** Ignore provenance/key order when checking whether rejection actually changed the party. */
export function samePartyValue(left: TripParty | undefined, right: TripParty | undefined): boolean {
  if (!left || !right) return left === right;
  const value = (p: TripParty) => JSON.stringify([p.adults,
    p.children.map((c) => JSON.stringify([c.age ?? null, c.ageGroup ?? null])).sort(), [...(p.composition ?? [])].sort(),
    (p.participants ?? []).map(({ id, role }) => `${id}:${role}`).sort()]);
  return value(left) === value(right);
}
