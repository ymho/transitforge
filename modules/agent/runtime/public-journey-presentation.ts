import type { JourneySearchResponse } from "@raiquora/journey/journey-search-service";

export const publicJourneyPresentationVersion = "public-journey-presentation-v1" as const;
export interface PublicJourneyPresentation {
  version: typeof publicJourneyPresentationVersion;
  presentationId: string;
  serviceDate: string;
  originStation: string;
  destinationStation: string;
  journeys: PublicJourney[];
  evidenceRefs: string[];
}
export interface PublicJourney {
  id: string;
  departureTime: string;
  arrivalTime: string;
  durationMinutes: number;
  transferCount: number;
  legs: Array<{ originStation: string; destinationStation: string; departureTime: string; arrivalTime: string;
    serviceUid: string; trainNumber: string; serviceType: string; trainName: string; serviceDestination?: string;
    delayMinutes?: number; delayStatus?: "observed" | "estimated"; delayBasis?: string; transferWaitMinutes?: number }>;
}

/** Application projection from validated Domain output. Model text and raw Tool envelopes are never inputs. */
export function projectPublicJourneyPresentation(result: JourneySearchResponse, selectedEvidenceIds?: ReadonlySet<string>): PublicJourneyPresentation | undefined {
  const selected = result.journeys.flatMap((journey, index) => {
    const evidenceId = `journey:${encodeURIComponent(result.serviceDate)}:${index}`;
    if (selectedEvidenceIds && !selectedEvidenceIds.has(evidenceId)) return [];
    return [{ evidenceId, journey, index }];
  }).slice(0, 3);
  if (!selected.length) return undefined;
  return parsePublicJourneyPresentation({
    version: publicJourneyPresentationVersion,
    presentationId: `journey-presentation:${encodeURIComponent(result.serviceDate)}:${encodeURIComponent(result.originStation)}:${encodeURIComponent(result.destinationStation)}`,
    serviceDate: result.serviceDate,
    originStation: result.originStation,
    destinationStation: result.destinationStation,
    evidenceRefs: selected.map(({ evidenceId }) => evidenceId),
    journeys: selected.map(({ journey, index }) => ({ id: `journey-${index + 1}`, departureTime: time(journey.departureTimeMinutes), arrivalTime: time(journey.arrivalTimeMinutes),
      durationMinutes: Math.max(0, journey.arrivalTimeMinutes - journey.departureTimeMinutes), transferCount: journey.transferCount,
      legs: journey.legs.map((leg, legIndex) => ({ originStation: leg.originStation, destinationStation: leg.destinationStation,
        departureTime: time(leg.departureTimeMinutes), arrivalTime: time(leg.arrivalTimeMinutes), serviceUid: leg.serviceUid,
        trainNumber: leg.trainNumber, serviceType: leg.serviceType, trainName: leg.trainName,
        ...(leg.serviceDestination ? { serviceDestination: leg.serviceDestination } : {}),
        ...(leg.delayStatus ? { delayMinutes: leg.delayMinutes, delayStatus: leg.delayStatus, ...(leg.delayBasis ? { delayBasis: leg.delayBasis } : {}) } : {}),
        ...(journey.legs[legIndex + 1] ? { transferWaitMinutes: Math.max(0, journey.legs[legIndex + 1]!.departureTimeMinutes - leg.arrivalTimeMinutes) } : {}) })) })),
  });
}

export function parsePublicJourneyPresentation(value: unknown): PublicJourneyPresentation {
  const v = value as Partial<PublicJourneyPresentation>;
  if (!record(value) || Object.keys(value).some((key) => !["version", "presentationId", "serviceDate", "originStation", "destinationStation", "journeys", "evidenceRefs"].includes(key)) ||
      v.version !== publicJourneyPresentationVersion || !short(v.presentationId, 500) || !date(v.serviceDate) || !short(v.originStation, 160) || !short(v.destinationStation, 160) ||
      !Array.isArray(v.evidenceRefs) || !v.evidenceRefs.length || !v.evidenceRefs.every((id) => short(id, 500)) ||
      !Array.isArray(v.journeys) || !v.journeys.length || v.journeys.length > 3 || !v.journeys.every(validJourney)) throw new Error("Invalid public journey presentation");
  return structuredClone(value) as unknown as PublicJourneyPresentation;
}
function validJourney(value: unknown): value is PublicJourney {
  const v = value as Partial<PublicJourney>; if (!record(value) || Object.keys(value).some((key) => !["id", "departureTime", "arrivalTime", "durationMinutes", "transferCount", "legs"].includes(key))) return false;
  return short(v.id, 120) && clock(v.departureTime) && clock(v.arrivalTime) && integer(v.durationMinutes, 0, 2_880) && integer(v.transferCount, 0, 3) && Array.isArray(v.legs) && v.legs.length >= 1 && v.legs.length <= 4 && v.legs.every(validLeg);
}
function validLeg(value: unknown): boolean {
  const v = value as PublicJourney["legs"][number]; if (!record(value) || Object.keys(value).some((key) => !["originStation", "destinationStation", "departureTime", "arrivalTime", "serviceUid", "trainNumber", "serviceType", "trainName", "serviceDestination", "delayMinutes", "delayStatus", "delayBasis", "transferWaitMinutes"].includes(key))) return false;
  return [v.originStation, v.destinationStation, v.serviceUid, v.trainNumber, v.serviceType, v.trainName].every((x) => short(x, 200)) && clock(v.departureTime) && clock(v.arrivalTime) &&
    (v.serviceDestination === undefined || short(v.serviceDestination, 200)) && (v.delayMinutes === undefined || integer(v.delayMinutes, 0, 1_440)) && (v.delayStatus === undefined || v.delayStatus === "observed" || v.delayStatus === "estimated") &&
    (v.delayBasis === undefined || short(v.delayBasis, 240)) && (v.transferWaitMinutes === undefined || integer(v.transferWaitMinutes, 0, 1_440));
}
function time(minutes: number): string { const normalized = Math.max(0, Math.trunc(minutes)); return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`; }
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function short(value: unknown, max: number): value is string { return typeof value === "string" && value.length > 0 && value.length <= max; }
function date(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value); }
function clock(value: unknown): value is string { return typeof value === "string" && /^\d{2,3}:\d{2}$/u.test(value); }
function integer(value: unknown, min: number, max: number): value is number { return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max; }
