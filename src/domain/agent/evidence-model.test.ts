import { describe, expect, it } from "vitest";

import type { JourneySearchResponse } from "../journey-search-service";
import type { TrainInspection } from "../network-inspection-service";
import {
  validateEvidenceAndClaims,
  type Evidence,
} from "./evidence-model";
import {
  evidenceFromCongestionAnalysis,
  evidenceFromDelayAnalysis,
  evidenceFromJourneySearch,
  evidenceFromTrainInspection,
} from "./tool-result-evidence";

const context = { retrievedAt: "2026-08-25T08:00:00.000Z" };

describe("evidence and grounded claims", () => {
  it("supports a fact only when every referenced Evidence ID exists", () => {
    const evidence = [fixtureEvidence("evidence-1")];
    const result = validateEvidenceAndClaims(evidence, [
      {
        id: "supported",
        statement: "列車は京都を8時に出発する",
        kind: "fact",
        evidenceIds: ["evidence-1"],
      },
      {
        id: "unsupported",
        statement: "列車には空席がある",
        kind: "fact",
        evidenceIds: ["missing"],
      },
      {
        id: "unknown",
        statement: "空席は判断できない",
        kind: "unknown",
        evidenceIds: [],
      },
    ]);

    expect(result.claims).toEqual([
      expect.objectContaining({ id: "supported", groundingStatus: "supported" }),
      expect.objectContaining({
        id: "unsupported",
        groundingStatus: "unsupported",
        missingEvidenceIds: ["missing"],
      }),
      expect.objectContaining({ id: "unknown", groundingStatus: "unknown" }),
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "unsupported_fact_claim" }),
    ]));
  });

  it("detects duplicate IDs and Evidence without a source reference", () => {
    const evidence = fixtureEvidence("duplicate");
    const result = validateEvidenceAndClaims([
      evidence,
      { ...evidence, references: [] },
    ], [
      { id: "claim", statement: "a", kind: "inference", evidenceIds: ["duplicate"] },
      { id: "claim", statement: "b", kind: "unknown", evidenceIds: ["duplicate"] },
    ]);

    expect(result.errors.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "duplicate_evidence_id",
      "missing_evidence_reference",
      "duplicate_claim_id",
      "invalid_unknown_claim",
    ]));
  });

  it("converts a journey and its observed delay into traceable Evidence", () => {
    const evidence = evidenceFromJourneySearch(journeyResult(), context);

    expect(evidence).toEqual([
      expect.objectContaining({
        category: "journey",
        knowledgeKind: "derived_value",
        facts: expect.objectContaining({
          durationMinutes: 60,
          transferCount: 0,
          serviceUids: ["service-1"],
        }),
        references: [
          expect.objectContaining({
            sourceType: "timetable-graph",
            sourceRef: "2026-08-25/connection-index.json.gz",
            freshness: "scheduled",
          }),
          expect.objectContaining({
            sourceType: "realtime-delay",
            freshness: "current",
          }),
        ],
      }),
    ]);
  });

  it("converts train delay and congestion Tool results without inventing facts", () => {
    const train = evidenceFromTrainInspection(trainInspection(), context)[0];
    const delay = evidenceFromDelayAnalysis(delayAnalysis(), context)[0];
    const congestion = evidenceFromCongestionAnalysis(congestionAnalysis(), context)[0];

    expect(train).toMatchObject({
      category: "train",
      knowledgeKind: "deterministic_fact",
      references: [{ sourceType: "timetable-index" }],
    });
    expect(delay).toMatchObject({
      category: "delay",
      facts: { sampleCount: 1, latestDelayedTrainCount: 0 },
      references: [{ sourceType: "operating-day-summary", freshness: "current" }],
    });
    expect(congestion).toMatchObject({
      category: "congestion",
      facts: { sampleCount: 0, peakTotalCongestion: null },
      references: [{ freshness: "unknown" }],
    });
  });
});

function fixtureEvidence(id: string): Evidence {
  return {
    id,
    category: "timetable",
    knowledgeKind: "deterministic_fact",
    subject: "列車",
    facts: { departureTimeMinutes: 480 },
    references: [{
      sourceType: "timetable-index",
      sourceRef: "date:service",
      retrievedAt: context.retrievedAt,
      freshness: "scheduled",
      summary: "時刻表",
    }],
  };
}

function journeyResult(): JourneySearchResponse {
  return {
    serviceDate: "2026-08-25",
    originStation: "京都",
    destinationStation: "大阪",
    searchTimeMinutes: 480,
    totalMatchCount: 1,
    matches: [{
      serviceUid: "service-1",
      trainNumber: "100M",
      serviceType: "新快速",
      trainName: "",
      originStation: "京都",
      destinationStation: "大阪",
      departureTimeMinutes: 480,
      arrivalTimeMinutes: 540,
      scheduledDepartureTimeMinutes: 475,
      scheduledArrivalTimeMinutes: 535,
      delayMinutes: 5,
      delayStatus: "observed",
      source: "transitforge",
      discoverySource: "timetable-graph",
      sourceReference: "2026-08-25/connection-index.json.gz",
    }],
    journeys: [{
      departureTimeMinutes: 480,
      arrivalTimeMinutes: 540,
      transferCount: 0,
      legs: [{
        serviceUid: "service-1",
        trainNumber: "100M",
        serviceType: "新快速",
        trainName: "",
        originStation: "京都",
        destinationStation: "大阪",
        departureTimeMinutes: 480,
        arrivalTimeMinutes: 540,
        scheduledDepartureTimeMinutes: 475,
        scheduledArrivalTimeMinutes: 535,
        delayMinutes: 5,
        delayStatus: "observed",
      }],
    }],
  };
}

function trainInspection(): TrainInspection {
  return {
    serviceUid: "service-1",
    trainNumber: "100M",
    serviceType: "新快速",
    trainName: "",
    originStation: "京都",
    destinationStation: "大阪",
    lineName: "JR京都線",
    timetableStopCount: 4,
    serviceDate: "2026-08-25",
    source: "timetable",
  };
}

function delayAnalysis() {
  return {
    serviceDate: "2026-08-25",
    sampleCount: 1,
    observationStart: "2026-08-25T07:59:00Z",
    observationEnd: "2026-08-25T08:00:00Z",
    latest: {
      collectedAt: "2026-08-25T08:00:00Z",
      sourceCount: 1,
      failureCount: 0,
      observedTrainCount: 10,
      delayedTrainCount: 0,
      totalDelayMinutes: 0,
      maximumDelayMinutes: 0,
      topTrains: [],
    },
    peak: null,
    hourly: [],
    topTrains: [],
    unmatchedTrainCount: 0,
    sourceMetadata: {
      source: "operating-day-summary" as const,
      aggregation: "deterministic-v1" as const,
      serviceDate: "2026-08-25",
      sampleCount: 1,
      observationStart: "2026-08-25T07:59:00Z",
      observationEnd: "2026-08-25T08:00:00Z",
      observationStatus: "observed" as const,
    },
  };
}

function congestionAnalysis() {
  return {
    serviceDate: "2026-08-25",
    sampleCount: 0,
    observationStart: null,
    observationEnd: null,
    peak: null,
    hourly: [],
    topLines: [],
    topTrains: [],
    unmatchedTrainCount: 0,
    sourceMetadata: {
      source: "operating-day-summary" as const,
      aggregation: "deterministic-v1" as const,
      serviceDate: "2026-08-25",
      sampleCount: 0,
      observationStart: null,
      observationEnd: null,
      observationStatus: "unobserved" as const,
    },
  };
}
