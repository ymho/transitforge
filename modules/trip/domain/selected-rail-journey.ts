import type { JourneyRouteResult } from "@raiquora/journey/direct-route-search";
import { isTransferPace, type TransferPace } from "@raiquora/journey/journey-search-preferences";
import { requiredTransferMinutes } from "@raiquora/journey/transfer-time";
import { normalizeStationName } from "@raiquora/train/station-name";
import type { TrainIndex } from "@raiquora/train/train";
import type { ExternalSourceEvidence } from "./external-travel-information";

export const railValidationPolicyVersion = "scheduled-rail-v1";

/** Plan facts only. Place and general schedule value objects are extended in #414/#386. */
export interface ScheduledRailLeg {
  readonly id: string;
  readonly serviceDate: string;
  readonly serviceUid: string;
  readonly trainNumber: string;
  readonly origin: { readonly name: string };
  readonly destination: { readonly name: string };
  readonly originStopIndex: number;
  readonly destinationStopIndex: number;
  readonly scheduledDeparture: { readonly at: string; readonly timeZone: "Asia/Tokyo" };
  readonly scheduledArrival: { readonly at: string; readonly timeZone: "Asia/Tokyo" };
}

export interface SelectedRailJourney {
  readonly serviceDate: string;
  readonly selectedAt: string;
  readonly legs: readonly ScheduledRailLeg[];
  readonly transfers: readonly {
    fromLegId: string; toLegId: string; minimumTransferMinutes: number;
  }[];
  readonly provenance: {
    readonly verifiedJourneyRef: string;
    readonly verifiedAt: string;
    readonly sources: readonly ExternalSourceEvidence[];
    /** Ordered one per leg, including repeats: the source of each stop index is unambiguous. */
    readonly timetableInputs: readonly {
      sourceId: string; serviceDate: string; contentDigest: string;
    }[];
    readonly validationPolicyVersion: string;
    readonly transferPace: TransferPace;
  };
}

/** Application supplies immutable, digest-verified schedule input, never a realtime-adjusted index. */
export interface RailTimetableInput {
  sourceId: string;
  contentDigest: string;
  index: TrainIndex;
  evidence: ExternalSourceEvidence;
  defaultTransferMinutes: number;
  stationTransferMinutes: Readonly<Record<string, number>>;
}

/** Task-local candidate binding, not a persistence model or LLM-provided proof. */
export interface VerifiedRailCandidate {
  candidateId: string;
  verifiedJourneyRef: string;
  verifiedAt: string;
  journey: JourneyRouteResult;
  transferPace: TransferPace;
  legReferences: readonly {
    sourceId: string; contentDigest: string; serviceDate: string;
    originStopIndex: number; destinationStopIndex: number;
  }[];
}

export function selectRailJourney(
  candidate: VerifiedRailCandidate,
  inputs: readonly RailTimetableInput[],
  selectedAt: string,
): SelectedRailJourney {
  if (!candidate.candidateId || !candidate.verifiedJourneyRef || !validInstant(candidate.verifiedAt) ||
      !validInstant(selectedAt) || Date.parse(selectedAt) < Date.parse(candidate.verifiedAt) ||
      !isTransferPace(candidate.transferPace) || !candidate.journey.legs.length ||
      candidate.legReferences.length !== candidate.journey.legs.length) {
    throw new Error("Rail candidate verification is incomplete");
  }
  const sources: ExternalSourceEvidence[] = [];
  const timetableInputs: SelectedRailJourney["provenance"]["timetableInputs"][number][] = [];
  const transfers: SelectedRailJourney["transfers"][number][] = [];
  const legs = candidate.journey.legs.map((leg, index): ScheduledRailLeg => {
    const ref = candidate.legReferences[index]!;
    const matches = inputs.filter((input) => input.sourceId === ref.sourceId &&
      input.contentDigest === ref.contentDigest && input.index.service_date === ref.serviceDate);
    if (matches.length !== 1 || !ref.sourceId || !ref.contentDigest) throw new Error("Timetable input missing or ambiguous");
    const input = matches[0]!;
    if (input.index.schema_version !== "train-index-v1") throw new Error("Unsupported timetable input");
    const trains = input.index.trains.filter((train) => train.service_uid === leg.serviceUid);
    if (trains.length !== 1 || !leg.serviceUid || !leg.trainNumber || trains[0]!.train_no !== leg.trainNumber ||
        !Number.isSafeInteger(ref.originStopIndex) || ref.originStopIndex < 0 ||
        !Number.isSafeInteger(ref.destinationStopIndex) || ref.destinationStopIndex <= ref.originStopIndex) {
      throw new Error("Rail service/stop identity is ambiguous");
    }
    const origin = trains[0]!.stops[ref.originStopIndex];
    const destination = trains[0]!.stops[ref.destinationStopIndex];
    if (!origin?.station_name || !destination?.station_name ||
        normalizeStationName(origin.station_name) !== normalizeStationName(leg.originStation) ||
        normalizeStationName(destination.station_name) !== normalizeStationName(leg.destinationStation) ||
        origin.event !== "発" || destination.event !== "着" ||
        origin.route_time_minutes === undefined || destination.route_time_minutes === undefined ||
        (leg.scheduledDepartureTimeMinutes ?? leg.departureTimeMinutes) !== origin.route_time_minutes ||
        (leg.scheduledArrivalTimeMinutes ?? leg.arrivalTimeMinutes) !== destination.route_time_minutes ||
        destination.route_time_minutes < origin.route_time_minutes) {
      throw new Error("Candidate does not match scheduled stop facts");
    }
    const evidence = input.evidence;
    if (!evidence.id || evidence.kind !== "timetable" || !evidence.provider || evidence.sourceId !== input.sourceId ||
        evidence.confidence !== "provider-schedule" || !validInstant(evidence.retrievedAt) ||
        Date.parse(evidence.retrievedAt) > Date.parse(candidate.verifiedAt)) {
      throw new Error("Timetable provenance is incomplete");
    }
    // No raw payload, URL, extra metadata, observation or spread crosses this boundary.
    sources.push({ id: evidence.id, kind: evidence.kind, provider: evidence.provider,
      sourceId: evidence.sourceId, retrievedAt: evidence.retrievedAt, confidence: "provider-schedule" });
    timetableInputs.push({ sourceId: input.sourceId, serviceDate: ref.serviceDate, contentDigest: input.contentDigest });
    const result: ScheduledRailLeg = {
      id: `leg-${index + 1}`, serviceDate: ref.serviceDate, serviceUid: leg.serviceUid,
      trainNumber: leg.trainNumber, origin: { name: origin.station_name }, destination: { name: destination.station_name },
      originStopIndex: ref.originStopIndex, destinationStopIndex: ref.destinationStopIndex,
      scheduledDeparture: scheduledInstant(ref.serviceDate, origin.route_time_minutes),
      scheduledArrival: scheduledInstant(ref.serviceDate, destination.route_time_minutes),
    };
    if (index > 0) {
      const station = Object.entries(input.stationTransferMinutes).find(([name]) =>
        normalizeStationName(name) === normalizeStationName(origin.station_name!));
      transfers.push({ fromLegId: `leg-${index}`, toLegId: result.id,
        minimumTransferMinutes: requiredTransferMinutes(station?.[1] ?? input.defaultTransferMinutes, candidate.transferPace) });
    }
    return result;
  });
  const result: SelectedRailJourney = {
    serviceDate: legs[0]!.serviceDate, selectedAt, legs, transfers,
    provenance: { verifiedJourneyRef: candidate.verifiedJourneyRef, verifiedAt: candidate.verifiedAt,
      sources, timetableInputs, validationPolicyVersion: railValidationPolicyVersion, transferPace: candidate.transferPace },
  };
  validateSelectedRailJourney(result);
  return result;
}

/** Also called before applying a Trip patch. Unknown keys cannot become hidden storage. */
export function validateSelectedRailJourney(value: SelectedRailJourney): void {
  exactKeys(value, ["serviceDate", "selectedAt", "legs", "transfers", "provenance"]);
  const p = value.provenance;
  exactKeys(p, ["verifiedJourneyRef", "verifiedAt", "sources", "timetableInputs", "validationPolicyVersion", "transferPace"]);
  if (!validInstant(value.selectedAt) || !validInstant(p.verifiedAt) || Date.parse(value.selectedAt) < Date.parse(p.verifiedAt) ||
      !p.verifiedJourneyRef || p.validationPolicyVersion !== railValidationPolicyVersion || !isTransferPace(p.transferPace) ||
      !value.legs.length || value.transfers.length !== value.legs.length - 1 ||
      p.timetableInputs.length !== value.legs.length || p.sources.length !== value.legs.length ||
      new Set(value.legs.map((leg) => leg.id)).size !== value.legs.length || value.serviceDate !== value.legs[0]!.serviceDate) {
    throw new Error("Invalid selected rail journey");
  }
  value.legs.forEach((leg, index) => {
    exactKeys(leg, ["id", "serviceDate", "serviceUid", "trainNumber", "origin", "destination", "originStopIndex", "destinationStopIndex", "scheduledDeparture", "scheduledArrival"]);
    exactKeys(leg.origin, ["name"]); exactKeys(leg.destination, ["name"]);
    exactKeys(leg.scheduledDeparture, ["at", "timeZone"]); exactKeys(leg.scheduledArrival, ["at", "timeZone"]);
    const source = p.timetableInputs[index]!;
    const evidence = p.sources[index]!;
    exactKeys(source, ["sourceId", "serviceDate", "contentDigest"]);
    exactKeys(evidence, ["id", "kind", "provider", "sourceId", "retrievedAt", "confidence"]);
    if (!leg.id || !leg.serviceUid || !leg.trainNumber || !leg.origin.name || !leg.destination.name ||
        !validDate(leg.serviceDate) || source.serviceDate !== leg.serviceDate || !source.sourceId || !source.contentDigest ||
        !evidence.id || evidence.kind !== "timetable" || !evidence.provider || evidence.sourceId !== source.sourceId || evidence.confidence !== "provider-schedule" ||
        !validInstant(evidence.retrievedAt) || Date.parse(evidence.retrievedAt) > Date.parse(p.verifiedAt) ||
        !Number.isSafeInteger(leg.originStopIndex) || leg.originStopIndex < 0 ||
        !Number.isSafeInteger(leg.destinationStopIndex) || leg.destinationStopIndex <= leg.originStopIndex ||
        !validInstant(leg.scheduledDeparture.at) || !validInstant(leg.scheduledArrival.at) ||
        leg.scheduledDeparture.timeZone !== "Asia/Tokyo" || leg.scheduledArrival.timeZone !== "Asia/Tokyo" ||
        Date.parse(leg.scheduledArrival.at) < Date.parse(leg.scheduledDeparture.at)) throw new Error("Invalid scheduled rail leg");
    if (index === 0) return;
    const previous = value.legs[index - 1]!;
    const transfer = value.transfers[index - 1]!;
    exactKeys(transfer, ["fromLegId", "toLegId", "minimumTransferMinutes"]);
    if (transfer.fromLegId !== previous.id || transfer.toLegId !== leg.id ||
        !Number.isFinite(transfer.minimumTransferMinutes) || transfer.minimumTransferMinutes < 2 ||
        normalizeStationName(previous.destination.name) !== normalizeStationName(leg.origin.name) ||
        Date.parse(previous.scheduledArrival.at) + transfer.minimumTransferMinutes * 60_000 > Date.parse(leg.scheduledDeparture.at)) {
      throw new Error("Transfer is not feasible on the scheduled timetable");
    }
  });
}

/** Revalidation reports changed/missing inputs without modifying the adopted snapshot. */
export function revalidateSelectedRailJourney(value: SelectedRailJourney, inputs: readonly RailTimetableInput[]): boolean {
  try {
    validateSelectedRailJourney(value);
    const rebuilt = selectRailJourney({
      candidateId: value.provenance.verifiedJourneyRef,
      verifiedJourneyRef: value.provenance.verifiedJourneyRef, verifiedAt: value.provenance.verifiedAt,
      transferPace: value.provenance.transferPace,
      journey: { departureTimeMinutes: 0, arrivalTimeMinutes: 0, transferCount: value.transfers.length,
        legs: value.legs.map((leg) => ({ serviceUid: leg.serviceUid, trainNumber: leg.trainNumber,
          serviceType: "", trainName: "", originStation: leg.origin.name, destinationStation: leg.destination.name,
          departureTimeMinutes: serviceMinutes(leg.serviceDate, leg.scheduledDeparture.at),
          arrivalTimeMinutes: serviceMinutes(leg.serviceDate, leg.scheduledArrival.at) })) },
      legReferences: value.legs.map((leg, index) => ({
        ...value.provenance.timetableInputs[index]!, originStopIndex: leg.originStopIndex, destinationStopIndex: leg.destinationStopIndex,
      })),
    }, inputs, value.selectedAt);
    return JSON.stringify(rebuilt.legs) === JSON.stringify(value.legs) && JSON.stringify(rebuilt.transfers) === JSON.stringify(value.transfers);
  } catch { return false; }
}

function scheduledInstant(serviceDate: string, minutes: number): ScheduledRailLeg["scheduledDeparture"] {
  if (!validDate(serviceDate) || !Number.isSafeInteger(minutes) || minutes < 0) throw new Error("Invalid service date/time");
  // Preserve service-day minutes > 1440. General timezone/schedule contract belongs to #386.
  const date = new Date(Date.parse(`${serviceDate}T00:00:00+09:00`) + minutes * 60_000);
  return { at: date.toISOString(), timeZone: "Asia/Tokyo" };
}
function serviceMinutes(date: string, at: string): number { return (Date.parse(at) - Date.parse(`${date}T00:00:00+09:00`)) / 60_000; }
export function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function validInstant(value: string): boolean {
  return typeof value === "string" && validDate(value.slice(0, 10)) &&
    /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) && Number.isFinite(Date.parse(value));
}
export function exactKeys(value: object, allowed: readonly string[]): void {
  if (!value || typeof value !== "object" || Object.keys(value).some((key) => !allowed.includes(key))) throw new Error("Unknown field in Trip snapshot");
}
