import { describe, expect, it, vi } from "vitest";

import type { JourneySearchService } from "@raiquora/journey/journey-search-service";
import type { StationLineCatalog } from "@raiquora/train/station";
import type { Train } from "@raiquora/train/train";

import { createJourneySearchHandlers, formatServiceDate } from "./create-journey-search-handlers";

const trains: Train[] = [
  train("limited", "1M", "特急", "はるか1号", 600),
  train("local", "2M", "普通", "", 610),
];
const catalog: StationLineCatalog = {
  schema_version: "station-line-catalog-v1",
  source: "test",
  lines: [{
    operator: "test",
    line: "test",
    stations: [
      { name: "大阪", coordinate: [135.5, 34.7] },
      { name: "京都", coordinate: [135.7, 35] },
    ],
  }],
};

describe("createJourneySearchHandlers", () => {
  it("keeps explicit-origin local search deterministic and applies exclusions", async () => {
    const currentCoordinate = vi.fn();
    const handlers = createJourneySearchHandlers({
      trains,
      getDisplayTrains: () => trains,
      stationLineCatalog: catalog,
      getDisplayedServiceDateStart: () => new Date(2026, 7, 27),
      currentCoordinate,
      journeySearchService: { search: vi.fn() } as unknown as JourneySearchService,
      linePresentation: {
        colorForStations: () => ({ color: "#000", lineName: "テスト線" }),
      },
    });

    const result = await handlers.localSearchRoutes({
      originStation: "大阪",
      destinationStation: "京都",
      departureTimeMinutes: 590,
      excludedTrainNames: ["はるか"],
    });

    expect(result.results?.map(({ train }) => train.service_uid)).toEqual(["local"]);
    expect(currentCoordinate).not.toHaveBeenCalled();
  });

  it("formats a service date in local calendar time", () => {
    expect(formatServiceDate(new Date(2026, 7, 5))).toBe("2026-08-05");
  });
});

function train(
  serviceUid: string,
  trainNumber: string,
  serviceType: string,
  trainName: string,
  departure: number,
): Train {
  return {
    service_uid: serviceUid,
    train_no: trainNumber,
    service_type: serviceType,
    train_name: trainName,
    origin_station: "大阪",
    destination_station: "京都",
    stops: [
      { station_name: "大阪", event: "発", route_time_minutes: departure },
      { station_name: "京都", event: "着", route_time_minutes: departure + 30 },
    ],
  };
}
