import type { RailTimetableInput, VerifiedRailCandidate } from "./selected-rail-journey";

/** Synthetic schedule only; no provider payload or private timetable. */
export function railSelectionFixture(): { candidate: VerifiedRailCandidate; inputs: RailTimetableInput[]; selectedAt: string } {
  return {
    selectedAt: "2026-09-12T08:00:00Z",
    candidate: {
      candidateId: "candidate-a", verifiedJourneyRef: "task-a/search-1/result-1", verifiedAt: "2026-09-12T07:59:00Z", transferPace: "standard",
      journey: { departureTimeMinutes: 550, arrivalTimeMinutes: 650, transferCount: 1, legs: [
        { serviceUid: "s1", trainNumber: "1M", serviceType: "普通", trainName: "", originStation: "A", destinationStation: "B",
          departureTimeMinutes: 550, arrivalTimeMinutes: 610, scheduledDepartureTimeMinutes: 540, scheduledArrivalTimeMinutes: 600, delayMinutes: 10, delayStatus: "observed" },
        { serviceUid: "s2", trainNumber: "2M", serviceType: "普通", trainName: "", originStation: "B", destinationStation: "C",
          departureTimeMinutes: 620, arrivalTimeMinutes: 650, scheduledDepartureTimeMinutes: 610, scheduledArrivalTimeMinutes: 640, delayMinutes: 10, delayStatus: "estimated" },
      ] },
      legReferences: [
        { sourceId: "synthetic-timetable", contentDigest: "sha256:fixture-a", serviceDate: "2026-09-13", originStopIndex: 0, destinationStopIndex: 1 },
        { sourceId: "synthetic-timetable", contentDigest: "sha256:fixture-a", serviceDate: "2026-09-13", originStopIndex: 0, destinationStopIndex: 1 },
      ],
    },
    inputs: [{ sourceId: "synthetic-timetable", contentDigest: "sha256:fixture-a", defaultTransferMinutes: 5, stationTransferMinutes: {},
      evidence: { id: "input-evidence", kind: "timetable", provider: "timetable", sourceId: "synthetic-timetable", retrievedAt: "2026-09-12T07:58:00Z", confidence: "provider-schedule" },
      index: { schema_version: "train-index-v1", path_catalog: "synthetic", service_date: "2026-09-13",
        station_line_catalog: { schema_version: "station-line-catalog-v1", source: "synthetic", lines: [
          { operator: "fixture", line: "fixture", stations: [
            { name: "A", coordinate: [135, 35] }, { name: "B", coordinate: [135.1, 35] }, { name: "C", coordinate: [135.2, 35] },
          ] },
        ] }, trains: [
        { service_uid: "s1", train_no: "1M", service_type: "普通", train_name: "", origin_station: "A", destination_station: "B",
          stops: [{ station_name: "A", event: "発", route_time_minutes: 540 }, { station_name: "B", event: "着", route_time_minutes: 600 }] },
        { service_uid: "s2", train_no: "2M", service_type: "普通", train_name: "", origin_station: "B", destination_station: "C",
          stops: [{ station_name: "B", event: "発", route_time_minutes: 610 }, { station_name: "C", event: "着", route_time_minutes: 640 }] },
      ] },
    }],
  };
}
