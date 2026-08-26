import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { searchJourneyIndex } from "./journey-search-engine";
import type { JourneySearchRequest } from "./journey-search-service";

interface Scenario { id: string; services: Service[]; request: JourneySearchRequest; expect: Record<string, any>; delays?: Record<string, number>; stationTransferMinutes?: Record<string, number>; serviceDate?: string; }
interface Service { id: string; trainNumber: string; serviceType?: string; trainName?: string; stops: Array<{ station: string; arrival?: number; departure?: number }>; }

const scenarios = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../tests/fixtures/journey-search-scenarios.json"), "utf8")) as Scenario[];

describe("journey search scenario parity", () => {
  for (const scenario of scenarios) it(scenario.id, () => {
    const request = {
      ...scenario.request,
      serviceDate: scenario.request.serviceDate ?? scenario.serviceDate ?? "2026-08-15",
      limit: scenario.request.limit ?? 3,
      maxTransfers: scenario.request.maxTransfers ?? 3,
      transferPace: scenario.request.transferPace ?? "standard",
      rankingPreference: scenario.request.rankingPreference ?? "balanced",
    };
    const index = request.maxTransfers <= 1 ? directIndex(scenario) : connectionIndex(scenario);
    const result = searchJourneyIndex(request, { index, delays: scenario.delays });
    expect(result.journeys).toHaveLength(scenario.expect.journeyCount);
    if (scenario.expect.firstJourney) {
      const first = result.journeys[0]!;
      expect({ trains: first.legs.map(({ trainNumber }) => trainNumber), departure: first.departureTimeMinutes, arrival: first.arrivalTimeMinutes, transferCount: first.transferCount, transferStations: first.legs.slice(0, -1).map(({ destinationStation }) => destinationStation) }).toMatchObject(scenario.expect.firstJourney);
    }
    for (const [name, minimum] of Object.entries(scenario.expect.traceMinimum ?? {})) expect(Number(result.trace[name])).toBeGreaterThanOrEqual(Number(minimum));
  });

  it("applies constraints delay estimation destination changes and missing active trains", () => {
    const scenario: Scenario = {
      id: "realtime",
      request: { serviceDate: "2026-08-15", originStation: "A", destinationStation: "D", departureTimeMinutes: 600, maxTransfers: 3, requiredTrainNames: ["やくも"] },
      services: [
        { id: "observed", trainNumber: "100M", stops: [{ station: "A", departure: 580 }, { station: "B", arrival: 590 }] },
        { id: "feeder", trainNumber: "101M", stops: [{ station: "A", departure: 610 }, { station: "B", arrival: 620 }] },
        { id: "yakumo", trainNumber: "1005M", trainName: "やくも5号", serviceType: "特急", stops: [{ station: "B", departure: 635 }, { station: "D", arrival: 655 }] },
      ],
      expect: {},
    };
    const index = connectionIndex(scenario);
    const estimated = searchJourneyIndex(scenario.request, { index, operations: { "100M": { delayMinutes: 8, destination: "B", sources: ["web"] }, "1005M": { delayMinutes: 0, destination: "D", sources: ["web"] } } });
    expect(estimated.journeys[0]?.legs.map(({ trainNumber }) => trainNumber)).toEqual(["101M", "1005M"]);
    expect(estimated.journeys[0]?.legs[0]?.delayStatus).toBe("estimated");

    const changed = searchJourneyIndex({ ...scenario.request, requiredTrainNames: [] }, { index, operations: { "101M": { delayMinutes: 0, destination: "B", sources: ["web"] }, "1005M": { delayMinutes: 0, destination: "C", sources: ["web"] } }, realtimeRouteTime: 615 });
    expect(changed.journeys).toEqual([]);
    expect(changed.trace.realtimeActiveServicesRejected).toBeGreaterThan(0);
  });
});

function directIndex(scenario: Scenario) {
  return { schema_version: "direct-service-index-v1", service_date: scenario.serviceDate ?? "2026-08-15", services: Object.fromEntries(scenario.services.map((item) => [item.id, { service_uid: item.id, train_no: item.trainNumber, service_type: item.serviceType ?? "普通", train_name: item.trainName ?? "", origin_station: item.stops[0]!.station, destination_station: item.stops.at(-1)!.station, calls: item.stops.map((stop) => ({ station_name: stop.station, ...(stop.arrival === undefined ? {} : { arrival_time_minutes: stop.arrival }), ...(stop.departure === undefined ? {} : { departure_time_minutes: stop.departure }) })) }])) };
}

function connectionIndex(scenario: Scenario) {
  const trips: Record<string, unknown> = {}; const connections: Record<string, unknown>[] = [];
  for (const item of scenario.services) { trips[item.id] = { service_uid: item.id, train_no: item.trainNumber, service_type: item.serviceType ?? "普通", train_name: item.trainName ?? "", origin_station: item.stops[0]!.station, destination_station: item.stops.at(-1)!.station }; for (let index = 0; index < item.stops.length - 1; index += 1) connections.push({ connection_id: `${item.id}:${index}`, trip_id: item.id, from_station: item.stops[index]!.station, to_station: item.stops[index + 1]!.station, departure_time_minutes: item.stops[index]!.departure, arrival_time_minutes: item.stops[index + 1]!.arrival, stop_sequence: index }); }
  connections.sort((a, b) => Number(a.departure_time_minutes) - Number(b.departure_time_minutes));
  return { schema_version: "timetable-connection-index-v1", service_date: scenario.serviceDate ?? "2026-08-15", default_transfer_minutes: 5, station_transfer_minutes: scenario.stationTransferMinutes ?? {}, trips, connections };
}
