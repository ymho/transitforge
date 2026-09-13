import type { Trip, ItineraryItem } from "./trip";
import { validateReservationFact } from "./reservation";
import { validateExternalSourceEvidence, type ExternalSourceEvidence } from "./external-travel-information";
import { exactKeys, validInstant } from "./snapshot-validation";
import { validateMoney } from "./money";
import type { TripFeasibilityFacts, TripFeasibilityFact } from "./trip-feasibility-contract";

export interface ReadFeasibilityFact { data: TripFeasibilityFact; evidenceIds: string[] }
/** Input validation is fail-closed, per observation. Failure/raw Provider text never escapes. */
export function readFeasibilityFacts(trip: Trip, input: TripFeasibilityFacts | undefined, now: string) {
  const facts: ReadFeasibilityFact[] = [];
  let invalid = false;
  if (!validInstant(now)) throw new Error("Invalid feasibility time");
  if (!input) return { facts, reservations: undefined, invalid };
  try {
    exactKeys(input, ["tripId", "tripRevision", "reservations", "external"]);
    if (input.tripId !== trip.id || input.tripRevision !== trip.revision) throw new Error("Stale feasibility facts");
    if (input.reservations !== undefined) {
      if (!Array.isArray(input.reservations)) throw new Error("Invalid reservations");
      input.reservations.forEach(validateReservationFact);
      if (new Set(input.reservations.map((r) => r.reservationId)).size !== input.reservations.length) throw new Error("Duplicate reservation");
    }
    if (input.external !== undefined && !Array.isArray(input.external)) throw new Error("Invalid external facts");
  } catch { return { facts, reservations: undefined, invalid: true }; }
  const sources = new Map<string, string>();
  for (const observation of input.external ?? []) {
    try {
      exactKeys(observation, ["status", "freshness", "data", "evidence", "failure"]);
      if (!["available", "unavailable", "unknown"].includes(observation.status) ||
          !["fresh", "stale", "unknown"].includes(observation.freshness) || !Array.isArray(observation.evidence)) throw new Error("Invalid external observation");
      if (observation.status !== "available" || observation.freshness !== "fresh") continue;
      if (observation.failure || !observation.data || !observation.evidence.length) throw new Error("Missing verified fact");
      const data = observation.data;
      validateFact(data, trip);
      const kinds = data.type === "movement" || data.type === "transport" ? ["timetable", "ground-access", "web"] :
        ["accommodation", "restaurant", "place", "event", "web"];
      let fresh = true;
      for (const source of observation.evidence) {
        validateExternalSourceEvidence(source);
        if (!kinds.includes(source.kind) || !["observed", "provider-schedule"].includes(source.confidence) ||
            Date.parse(source.retrievedAt) > Date.parse(now) || source.observedAt && Date.parse(source.observedAt) > Date.parse(source.retrievedAt)) throw new Error("Unverified source");
        if (!source.validUntil || Date.parse(source.validUntil) < Date.parse(now) ||
            source.validFrom && Date.parse(source.validFrom) > Date.parse(now)) fresh = false;
        const serialized = JSON.stringify(source);
        if (sources.has(source.id) && sources.get(source.id) !== serialized) throw new Error("Conflicting evidence");
        sources.set(source.id, serialized);
      }
      if (fresh) facts.push({ data, evidenceIds: observation.evidence.map((s: ExternalSourceEvidence) => s.id) });
    } catch { invalid = true; }
  }
  return { facts, reservations: input.reservations, invalid };
}

function validateFact(fact: TripFeasibilityFact, trip: Trip): void {
  const subject = (item: ItineraryItem) => {
    // Conservative exact comparison also rejects injected extra fields and stale same-revision proposals.
    if (!item || !trip.items.some((i) => i.id === item.id && JSON.stringify(i) === JSON.stringify(item))) throw new Error("Fact subject mismatch");
  };
  const minutes = (n: number) => { if (!Number.isSafeInteger(n) || n < 0) throw new Error("Invalid duration"); };
  switch (fact.type) {
    case "movement":
      exactKeys(fact, ["type", "beforeItem", "afterItem", "minimumMinutes"]); subject(fact.beforeItem); subject(fact.afterItem); minutes(fact.minimumMinutes);
      if (fact.beforeItem.id === fact.afterItem.id) throw new Error("Invalid movement subjects");
      break;
    case "transport":
      exactKeys(fact, ["type", "item", "minimumMinutes"]); subject(fact.item); minutes(fact.minimumMinutes);
      if (fact.item.type !== "transport" || fact.item.detail.status !== "selected" || fact.item.detail.mode === "rail") throw new Error("Not a non-rail movement");
      break;
    case "visit":
      exactKeys(fact, ["type", "item", "available", "reservationRequired"]); subject(fact.item);
      if (typeof fact.available !== "boolean" || typeof fact.reservationRequired !== "boolean" || fact.item.type === "transport") throw new Error("Invalid visit fact");
      break;
    case "cost":
      exactKeys(fact, ["type", "item", "total", "coverage", "party"]); subject(fact.item); validateMoney(fact.total);
      if (fact.coverage !== "complete-item" || JSON.stringify(fact.party) !== JSON.stringify(trip.request.party)) throw new Error("Unknown cost coverage");
      break;
    default: throw new Error("Unknown feasibility fact");
  }
}
