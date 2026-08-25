import type { JourneyComparison } from "../journey-comparison-service";
import type { JourneySearchResponse } from "../journey-search-service";
import type {
  RouteDetails,
  StationInspection,
  TrainInspection,
} from "../network-inspection-service";
import type {
  CongestionAnalysisToolOutput,
  DelayAnalysisToolOutput,
} from "./operational-analysis-tools";
import type {
  Evidence,
  EvidenceFreshness,
  EvidenceReference,
  EvidenceSourceType,
} from "./evidence-model";

export interface EvidenceConversionContext {
  retrievedAt: string;
}

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

export function evidenceFromTrainInspection(
  train: TrainInspection,
  context: EvidenceConversionContext,
): Evidence[] {
  return [{
    id: evidenceId("train", [train.serviceUid]),
    category: "train",
    knowledgeKind: "deterministic_fact",
    subject: `${train.trainNumber} ${train.trainName}`.trim(),
    facts: {
      serviceUid: train.serviceUid,
      serviceType: train.serviceType,
      originStation: train.originStation,
      destinationStation: train.destinationStation,
      lineName: train.lineName,
      timetableStopCount: train.timetableStopCount,
      serviceDate: train.serviceDate ?? null,
    },
    references: [reference(
      "timetable-index",
      `${train.serviceDate ?? "unknown"}:${train.serviceUid}`,
      context,
      "scheduled",
      `${train.trainNumber}の時刻表上の列車概要`,
    )],
  }];
}

export function evidenceFromStationInspection(
  station: StationInspection,
  context: EvidenceConversionContext,
): Evidence[] {
  return [{
    id: evidenceId("station", [station.normalizedStationName]),
    category: "station",
    knowledgeKind: "deterministic_fact",
    subject: station.stationName,
    facts: {
      stationName: station.stationName,
      lines: station.lines.map(({ operator, lineName }) => `${operator}:${lineName}`),
      totalLineCount: station.totalLineCount,
      timetableServiceCount: station.timetableServiceCount,
      serviceTypes: station.serviceTypes,
    },
    references: [reference(
      station.source === "station-line-catalog"
        ? "station-line-catalog"
        : "timetable-index",
      station.catalogSource ?? `${station.serviceDate ?? "unknown"}:train-index`,
      context,
      station.source === "station-line-catalog" ? "scheduled" : "unknown",
      `${station.stationName}の路線と運行概要`,
    )],
  }];
}

export function evidenceFromRouteDetails(
  route: RouteDetails,
  context: EvidenceConversionContext,
): Evidence[] {
  return [{
    id: evidenceId("route", [
      route.train.serviceUid,
      route.segmentOriginStation,
      route.segmentDestinationStation,
    ]),
    category: "timetable",
    knowledgeKind: "deterministic_fact",
    subject: `${route.segmentOriginStation}から${route.segmentDestinationStation}の停車記録`,
    facts: {
      serviceUid: route.train.serviceUid,
      totalStopRecordCount: route.totalStopRecordCount,
      returnedStopRecordCount: route.returnedStopRecordCount,
      hasMore: route.hasMore,
      stations: route.stops.map(({ stationName }) => stationName),
    },
    references: [reference(
      "timetable-index",
      `${route.train.serviceDate ?? "unknown"}:${route.train.serviceUid}`,
      context,
      "scheduled",
      "検証済み列車の指定区間にある停車記録",
    )],
  }];
}

export function evidenceFromDelayAnalysis(
  analysis: DelayAnalysisToolOutput,
  context: EvidenceConversionContext,
): Evidence[] {
  return [{
    id: evidenceId("delay", [analysis.serviceDate]),
    category: "delay",
    knowledgeKind: "derived_value",
    subject: `${analysis.serviceDate}の遅延分析`,
    facts: {
      sampleCount: analysis.sampleCount,
      observationStatus: analysis.sourceMetadata.observationStatus,
      observationStart: analysis.observationStart,
      observationEnd: analysis.observationEnd,
      latestDelayedTrainCount: analysis.latest?.delayedTrainCount ?? null,
      latestMaximumDelayMinutes: analysis.latest?.maximumDelayMinutes ?? null,
      topTrainNumbers: analysis.topTrains.map(({ trainNumber }) => trainNumber),
    },
    references: [reference(
      "operating-day-summary",
      `delay:${analysis.serviceDate}`,
      context,
      analysis.sampleCount === 0
        ? "unknown"
        : freshnessForDate(analysis.serviceDate, context.retrievedAt),
      `${analysis.sampleCount}件の観測から決定論的に集計した遅延`,
    )],
  }];
}

export function evidenceFromCongestionAnalysis(
  analysis: CongestionAnalysisToolOutput,
  context: EvidenceConversionContext,
): Evidence[] {
  return [{
    id: evidenceId("congestion", [analysis.serviceDate]),
    category: "congestion",
    knowledgeKind: "derived_value",
    subject: `${analysis.serviceDate}の混雑分析`,
    facts: {
      sampleCount: analysis.sampleCount,
      observationStatus: analysis.sourceMetadata.observationStatus,
      observationStart: analysis.observationStart,
      observationEnd: analysis.observationEnd,
      peakTotalCongestion: analysis.peak?.totalCongestion ?? null,
      topLines: analysis.topLines.map(({ lineName }) => lineName),
      topTrainNumbers: analysis.topTrains.map(({ trainNumber }) => trainNumber),
    },
    references: [reference(
      "operating-day-summary",
      `congestion:${analysis.serviceDate}`,
      context,
      analysis.sampleCount === 0
        ? "unknown"
        : freshnessForDate(analysis.serviceDate, context.retrievedAt),
      `${analysis.sampleCount}件の観測から決定論的に集計した混雑`,
    )],
  }];
}

export function evidenceFromJourneyComparison(
  comparison: JourneyComparison,
  context: EvidenceConversionContext,
): Evidence[] {
  return comparison.candidates.map((candidate) => ({
    id: evidenceId("journey-comparison", [
      comparison.serviceDate,
      candidate.candidateId,
    ]),
    category: "journey",
    knowledgeKind: "derived_value",
    subject: `${comparison.originStation}から${comparison.destinationStation}の${candidate.candidateId}`,
    facts: {
      recommended: comparison.recommendedCandidateId === candidate.candidateId,
      durationMinutes: candidate.durationMinutes,
      transferCount: candidate.transferCount,
      totalAppliedDelayMinutes: candidate.delay.totalAppliedDelayMinutes,
      constraintsSatisfied: candidate.constraintsSatisfied,
      advantages: candidate.advantages,
    },
    references: [reference(
      "journey-comparison",
      `${comparison.serviceDate}:${candidate.candidateId}`,
      context,
      "current",
      "検証済み経路候補から決定論的に算出した比較結果",
    )],
  }));
}

export function unverifiedEvidence(
  input: {
    id: string;
    category: Evidence["category"];
    subject: string;
    summary: string;
  },
  context: EvidenceConversionContext,
): Evidence {
  return {
    id: input.id,
    category: input.category,
    knowledgeKind: "unverified_information",
    subject: input.subject,
    facts: {},
    references: [reference(
      "external-source",
      "unverified",
      context,
      "unknown",
      input.summary,
    )],
  };
}

export function modelInterpretationEvidence(
  input: {
    id: string;
    category: Evidence["category"];
    subject: string;
    summary: string;
    basedOnEvidenceIds: string[];
  },
  context: EvidenceConversionContext,
): Evidence {
  return {
    id: input.id,
    category: input.category,
    knowledgeKind: "model_interpretation",
    subject: input.subject,
    facts: { basedOnEvidenceIds: input.basedOnEvidenceIds },
    references: [reference(
      "model",
      "model-interpretation",
      context,
      "unknown",
      input.summary,
    )],
  };
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

function freshnessForDate(
  serviceDate: string,
  retrievedAt: string,
): EvidenceFreshness {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(retrievedAt));
  return serviceDate === today ? "current" : "historical";
}
