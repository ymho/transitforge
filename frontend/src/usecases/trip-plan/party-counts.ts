import type { TripParty } from "@raiquora/trip/trip-party";
import { validateTripParty } from "@raiquora/trip/trip-party";

/** Keep retained children and anonymous identities; new children have no guessed age. */
export function partyWithCounts(previous: TripParty | undefined, adults: number, children: number): Omit<TripParty, "source" | "assumptionId"> {
  if (!Number.isSafeInteger(children) || children < 0 || children > 100 || !Number.isSafeInteger(adults) || adults < 0 || adults > 100) throw new Error("人数を確認してください。");
  if (previous?.participants && (previous.adults !== adults || previous.children.length !== children)) throw new Error("参加者の記録があるため、人数変更は相談から行ってください。");
  const value = { adults, children: Array.from({ length: children }, (_, i) => previous?.children[i] ?? {}),
    ...(previous?.composition ? { composition: previous.composition } : {}), ...(previous?.participants ? { participants: previous.participants } : {}) };
  validateTripParty({ ...value, source: "user" }); return value;
}
