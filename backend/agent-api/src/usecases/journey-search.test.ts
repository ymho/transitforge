import { describe, expect, it, vi } from "vitest";

import type { JourneyDataRepository } from "../ports/journey-data.js";
import { createJourneySearchOperation, validatedJourneyRequest } from "./journey-search.js";

describe("journey search usecase", () => {
  it("keeps journey-search-v1 fields and hides trace unless requested", async () => {
    const loadIndex = vi.fn(async () => directIndex());
    const repository = { loadIndex, loadRealtimeSnapshot: async () => undefined } satisfies JourneyDataRepository;
    const operation = createJourneySearchOperation(repository, { now: () => new Date("2026-08-27T00:00:00Z") });
    const result = await operation({ contractVersion: "journey-search-v1", serviceDate: "2026-08-28", originStation: "A", destinationStation: "D", departureTimeMinutes: 590, maxTransfers: 0 }, { requestId: "request-1" });
    expect(result.body).toMatchObject({ contractVersion: "journey-search-v1", serviceDate: "2026-08-28", originStation: "A", destinationStation: "D", totalMatchCount: 1, realtime: { applied: false } });
    expect(result.body.trace).toBeUndefined();
    expect(loadIndex).toHaveBeenCalledWith("2026-08-28", "direct-service");
  });

  it("validates bounded constraints before reading storage", () => {
    expect(() => validatedJourneyRequest({ contractVersion: "journey-search-v1", serviceDate: "2026-08-28", originStation: "A", destinationStation: "D", departureTimeMinutes: 590, requiredTrainNames: ["a", "b", "c", "d", "e"] })).toThrow("多すぎます");
  });

  it("accepts an arrival deadline after the departure time", () => {
    expect(validatedJourneyRequest({
      contractVersion: "journey-search-v1",
      serviceDate: "2026-08-28",
      originStation: "A",
      destinationStation: "D",
      departureTimeMinutes: 590,
      arrivalTimeLimitMinutes: 700,
    })).toMatchObject({ arrivalTimeLimitMinutes: 700 });
    expect(() => validatedJourneyRequest({
      contractVersion: "journey-search-v1",
      serviceDate: "2026-08-28",
      originStation: "A",
      destinationStation: "D",
      departureTimeMinutes: 700,
      arrivalTimeLimitMinutes: 590,
    })).toThrow("arrivalTimeLimitMinutes");
  });
});

function directIndex() {
  return { schema_version: "direct-service-index-v1", services: { direct: { service_uid: "direct", train_no: "10M", service_type: "普通", train_name: "", origin_station: "A", destination_station: "D", calls: [{ station_name: "A", departure_time_minutes: 600 }, { station_name: "D", arrival_time_minutes: 640 }] } } };
}
