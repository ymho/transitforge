import type { JourneySearchResponse } from "@raiquora/journey/journey-search-service";
import type { Evidence, EvidenceFreshness, EvidenceReference, EvidenceSourceType } from "./evidence-model";
interface EvidenceConversionContext { retrievedAt: string }
export function evidenceFromJourneySearch(
  result: JourneySearchResponse,
  context: EvidenceConversionContext,
): Evidence[] {
  return result.journeys.map((journey, index) => {
    const references = uniqueReferences(journey.legs.flatMap((leg) => {
      const timetableReference = reference(
        "timetable-graph",
        sourceReferenceFor(result, leg.serviceUid),
        context,
        "scheduled",
        `${leg.trainNumber} ${leg.originStation}から${leg.destinationStation}`,
      );
      if (leg.delayStatus === undefined) return [timetableReference];
      return [
        timetableReference,
        reference(
          leg.delayStatus === "observed" ? "realtime-delay" : "estimated-delay",
          `${result.serviceDate}:${leg.serviceUid}`,
          context,
          leg.delayStatus === "observed" ? "current" : "unknown",
          `${leg.trainNumber}へ${leg.delayMinutes}分の遅延を適用`,
        ),
      ];
    }));
    return {
      id: evidenceId("journey", [result.serviceDate, index]),
      category: "journey",
      knowledgeKind: "derived_value",
      subject: `${result.originStation}から${result.destinationStation}の経路候補${index + 1}`,
      facts: {
        originStation: result.originStation,
        destinationStation: result.destinationStation,
        serviceDate: result.serviceDate,
        trainNumbers: journey.legs.map(({ trainNumber }) => trainNumber),
        includesDelay: journey.legs.some((leg) => leg.delayStatus !== undefined),
        departureTimeMinutes: journey.departureTimeMinutes,
        arrivalTimeMinutes: journey.arrivalTimeMinutes,
        durationMinutes: Math.max(0, journey.arrivalTimeMinutes - journey.departureTimeMinutes),
        transferCount: journey.transferCount,
        serviceUids: journey.legs.map(({ serviceUid }) => serviceUid),
      },
      references,
    };
  });
}

function sourceReferenceFor(result: JourneySearchResponse, serviceUid: string): string {
  return result.matches.find((match) => match.serviceUid === serviceUid)?.sourceReference ??
    `${result.serviceDate}:${serviceUid}`;
}

function reference(
  sourceType: EvidenceSourceType,
  sourceRef: string,
  context: EvidenceConversionContext,
  freshness: EvidenceFreshness,
  summary: string,
): EvidenceReference {
  return {
    sourceType,
    sourceRef,
    retrievedAt: context.retrievedAt,
    freshness,
    summary,
  };
}

function uniqueReferences(references: EvidenceReference[]): EvidenceReference[] {
  const seen = new Set<string>();
  return references.filter((item) => {
    const key = `${item.sourceType}\u0000${item.sourceRef}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function evidenceId(prefix: string, parts: Array<string | number>): string {
  return `${prefix}:${parts.map((part) => encodeURIComponent(String(part))).join(":")}`;
}
