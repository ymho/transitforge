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

  it("selects the latest departure that arrives by the requested deadline", () => {
    const scenario: Scenario = {
      id: "arrival-deadline",
      request: {
        serviceDate: "2026-08-31",
        originStation: "奈良",
        destinationStation: "向日町",
        departureTimeMinutes: 9 * 60,
        arrivalTimeLimitMinutes: 21 * 60,
        rankingPreference: "latest-departure",
        maxTransfers: 0,
      },
      services: [
        { id: "within", trainNumber: "1M", stops: [
          { station: "奈良", departure: 19 * 60 },
          { station: "向日町", arrival: 20 * 60 + 30 },
        ] },
        { id: "too-late", trainNumber: "2M", stops: [
          { station: "奈良", departure: 20 * 60 + 15 },
          { station: "向日町", arrival: 21 * 60 + 20 },
        ] },
      ],
      expect: {},
    };

    const result = searchJourneyIndex(scenario.request, { index: directIndex(scenario) });
    expect(result.journeys).toHaveLength(1);
    expect(result.journeys[0]).toMatchObject({
      departureTimeMinutes: 19 * 60,
      arrivalTimeMinutes: 20 * 60 + 30,
    });
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

it("does not connect the two 柏原 stations, but preserves Kyoto interchange and through trains", () => {
  const request: JourneySearchRequest = { serviceDate: "2026-08-15", originStation: "向日町", destinationStation: "豊岡", departureTimeMinutes: 600, maxTransfers: 3 };
  const scenario: Scenario = { id: "homonyms", request, expect: {}, services: [
    { id: "feeder", trainNumber: "1", stops: [{ station: "向日町", departure: 601 }, { station: "京都", arrival: 609 }] },
    { id: "shinkansen", trainNumber: "2", stops: [{ station: "京都", departure: 620 }, { station: "米原", arrival: 640 }] },
    { id: "tokaido", trainNumber: "3", stops: [{ station: "米原", departure: 650 }, { station: "柏原", arrival: 664, departure: 665 }, { station: "関ケ原", arrival: 670 }] },
    { id: "fukuchiyama", trainNumber: "4", stops: [{ station: "谷川", departure: 650 }, { station: "柏原", arrival: 670, departure: 673 }, { station: "豊岡", arrival: 760 }] },
    { id: "valid", trainNumber: "5", stops: [{ station: "京都", departure: 625 }, { station: "豊岡", arrival: 790 }] },
  ] };
  const catalog = { schema_version: "station-line-catalog-v1", source: "fixture", lines: [
    { operator: "JR", line: "東海道線", stations: [{ name: "米原", coordinate: [136.29, 35.31] }, { name: "柏原", coordinate: [136.40, 35.34] }, { name: "関ケ原", coordinate: [136.47, 35.36] }] },
    { operator: "JR", line: "福知山線", stations: [{ name: "谷川", coordinate: [135.05, 35.08] }, { name: "柏原", coordinate: [135.08, 35.13] }, { name: "豊岡", coordinate: [134.82, 35.54] }] },
    { operator: "JR", line: "JR京都線", stations: [{ name: "向日町", coordinate: [135.70, 34.95] }, { name: "京都", coordinate: [135.758, 34.986] }] },
    { operator: "JR", line: "東海道新幹線", stations: [{ name: "京都", coordinate: [135.7582, 34.9861] }, { name: "米原", coordinate: [136.29, 35.31] }] },
  ] };
  for (const index of [directIndex(scenario), connectionIndex(scenario)]) {
    const input = { index: { ...index, station_line_catalog: catalog } };
    const result = searchJourneyIndex(request, input);
    expect(result.journeys.map(j => j.legs.map(l => l.serviceUid))).toEqual([["feeder", "valid"]]);
    expect(searchJourneyIndex({ ...request, originStation: "米原", destinationStation: "関ケ原" }, input).journeys[0]?.legs[0]?.stops?.map(s => s.stationName)).toContain("柏原（東海道線）");
    expect(searchJourneyIndex({ ...request, originStation: "柏原", destinationStation: "豊岡" }, input).journeys).toEqual([]);
    expect(searchJourneyIndex({ ...request, originStation: "柏原（福知山線）", destinationStation: "豊岡" }, input).journeys).toHaveLength(1);
  }
});
