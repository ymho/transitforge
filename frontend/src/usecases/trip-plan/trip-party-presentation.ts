import { validateTripParty, type TripParty } from "@raiquora/trip/trip-party";
import { validateTripRequest, type TripRequest } from "@raiquora/trip/trip-request";
import type { Trip } from "@raiquora/trip/trip";
import type { ChildAgeGroup } from "@raiquora/trip/travel-profile";

const ageLabels: Record<ChildAgeGroup, string> = { baby: "乳児", preschool: "幼児", elementary: "小学生", teen: "ティーン" };
export function tripPartyLabel(party: TripParty): string {
  validateTripParty(party);
  const adults = party.adults === 2 && party.children.length === 0 && party.composition?.length === 1
    ? party.composition[0] === "partner" ? "夫婦2人" : party.composition[0] === "friends" ? "友人2人" : "大人2人"
    : party.adults > 0 ? `大人${party.adults}人` : "";
  const ages = party.children.map((c) => [c.age !== undefined ? `${c.age}歳` : undefined,
    c.ageGroup !== undefined ? ageLabels[c.ageGroup] : undefined].filter(Boolean).join("・") || "年齢未確認");
  return [adults, ages.length ? `子ども${ages.length}人（${ages.join("、")}）` : ""].filter(Boolean).join(" + ");
}
/** Share accepted composition across labels and editors; never invent a split. */
export function acceptedTripParty(request: TripRequest): TripParty | undefined {
  const accepted = request.partialConditions?.find(({ target, scope }) => target === "party_size" &&
    (scope.type === "conversation" || scope.type === "trip"));
  if (accepted?.value.kind === "party") {
    const { kind: _kind, ...fields } = accepted.value;
    return { ...fields, source: "user" };
  }
  return accepted ? undefined : request.party;
}

/** Read-only projection, no separate party state or guessed profile defaults. */
export function tripPartyView(trip: Pick<Trip, "request" | "items">) {
  validateTripRequest(trip.request, trip.items);
  const request: TripRequest = trip.request;
  const accepted = request.partialConditions?.find(({ target, scope }) => target === "party_size" &&
    (scope.type === "conversation" || scope.type === "trip"));
  if (accepted?.value.kind === "party") {
    const { kind: _kind, ...fields } = accepted.value;
    return { text: tripPartyLabel({ ...fields, source: "user" }), source: "user" as const };
  }
  if (accepted?.value.kind === "quantity" && accepted.value.unit === "people")
    return { text: `${accepted.value.amount}人（大人・子どもの内訳未確認）`, source: "user" as const };
  if (!request.party) return undefined;
  const assumption = request.assumptions.find((a) => a.id === request.party!.assumptionId);
  return { text: `${assumption?.status === "unconfirmed" ? "⚠ 仮置き: " : ""}${tripPartyLabel(request.party)}`,
    source: request.party.source, ...(assumption ? { assumptionId: assumption.id, status: assumption.status } : {}) };
}
