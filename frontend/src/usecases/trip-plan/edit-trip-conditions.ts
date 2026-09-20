import type { Trip, TripUpdateProposal } from "@raiquora/trip/trip";
import type { TripConstraint, TripRequirement } from "@raiquora/trip/trip-request";
import { proposeTripRequestUpdate, proposeUserParty } from "./update-trip-request";

/** An explicit edit detaches only this constraint's hypothesis, preserving item hypotheses. */
export function editTripConstraint(trip: Trip, id: string, requirement: TripRequirement | undefined,
  strength: "hard" | "soft" = "hard"): TripUpdateProposal {
  const previous = trip.request.constraints.find((c) => c.id === id);
  const constraints = trip.request.constraints.filter((c) => c.id !== id);
  if (requirement) constraints.push({ id, requirement, strength, source: "user", scope: previous?.scope ?? { type: "trip" } });
  const assumptions = trip.request.assumptions.map((a) => ({ ...a,
    affects: a.affects.filter((ref) => ref.type !== "constraint" || ref.constraintId !== id) }));
  return proposeTripRequestUpdate(trip, { ...trip.request, constraints, assumptions }, "user");
}
export function editTripParty(trip: Trip, adults: string, children: string): TripUpdateProposal {
  if (!adults.trim() && !children.trim()) return proposeTripRequestUpdate(trip, { ...trip.request, party: undefined,
    assumptions: trip.request.assumptions.map((a) => ({ ...a, affects: a.affects.filter((ref) => ref.type !== "party") })) }, "user");
  if (!/^\d+$/.test(adults) || Number(adults) > 100) throw new Error("大人の人数を0〜100で入力してください");
  const ages = children.trim() ? children.split(",").map((v) => v.trim()) : [];
  if (ages.length > 100 || ages.some((v) => v !== "?" && (!/^\d+$/.test(v) || Number(v) > 17))) throw new Error("子どもの年齢は0〜17、不明は?をカンマ区切りで入力してください");
  return proposeUserParty(trip, { adults: Number(adults), children: ages.map((age) => age === "?" ? {} : { age: Number(age) }) });
}
export function boundedConditionText(value: string): string {
  const text = value.trim();
  if (!text || text.length > 240) throw new Error("1〜240文字で入力してください");
  return text;
}
export type EditableCondition = Extract<TripRequirement["type"], "origin" | "destinations" | "dates" | "duration" | "mobility" | "pace" | "budget" | "experience">;
export function constraintSourceLabel(c: TripConstraint): string {
  return c.source === "user" ? "あなたが指定" : c.source === "profile" ? "プロフィール由来" : "仮置き";
}
