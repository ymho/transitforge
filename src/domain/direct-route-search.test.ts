import { describe, expect, it } from "vitest";
import type { StationLineCatalog } from "../data/station-line-catalog";
import type { Train } from "../data/train-index";
import {
  directRouteDepartureTime,
  nearestDirectOrigin,
  nearestOriginWithDepartures,
  searchDirectRoutes,
} from "./direct-route-search";

const trains: Train[] = [
  {
    service_uid: "later",
    train_no: "103M",
    service_type: "快速",
    train_name: "",
    origin_station: "大阪",
    destination_station: "京都",
    stops: [
      { station_name: "大阪", event: "発", route_time_minutes: 620 },
      { station_name: "新大阪", event: "着", route_time_minutes: 625 },
      { station_name: "新大阪", event: "発", route_time_minutes: 626 },
      { station_name: "京都", event: "着", route_time_minutes: 650 },
    ],
  },
  {
    service_uid: "earlier",
    train_no: "101M",
    service_type: "新快速",
    train_name: "",
    origin_station: "大阪",
    destination_station: "京都",
    stops: [
      { station_name: "大阪", event: "発", route_time_minutes: 610 },
      { station_name: "京都", event: "着", route_time_minutes: 640 },
    ],
  },
  {
    service_uid: "reverse",
    train_no: "202M",
    service_type: "快速",
    train_name: "",
    origin_station: "京都",
    destination_station: "大阪",
    stops: [
      { station_name: "京都", event: "発", route_time_minutes: 610 },
      { station_name: "大阪", event: "着", route_time_minutes: 640 },
    ],
  },
];

const catalog: StationLineCatalog = {
  schema_version: "station-line-catalog-v1",
  source: "test",
  lines: [{
    operator: "運行会社A",
    line: "テスト線",
    stations: [
      { name: "大阪", coordinate: [135.5, 34.7] },
      { name: "新大阪", coordinate: [135.501, 34.701] },
      { name: "京都", coordinate: [135.75, 35] },
    ],
  }],
};

describe("direct route search", () => {
  it("uses an explicit departure time or falls back to the current route time", () => {
    expect(directRouteDepartureTime(600, 1_388, 1_800)).toBe(600);
    expect(directRouteDepartureTime(undefined, 1_388.4, 1_800)).toBe(1_388);
    expect(directRouteDepartureTime(undefined, 1_900, 1_800)).toBe(1_800);
  });

  it("returns direct trains after the requested time in departure order", () => {
    const results = searchDirectRoutes(trains, "大阪駅", "京都", 600);
    expect(results.map((result) => result.train.service_uid)).toEqual([
      "earlier",
      "later",
    ]);
    expect(results[0]).toMatchObject({
      departureTimeMinutes: 610,
      arrivalTimeMinutes: 640,
    });
  });

  it("does not return a train travelling in the opposite direction", () => {
    expect(searchDirectRoutes(trains, "京都", "大阪", 600)).toHaveLength(1);
    expect(searchDirectRoutes(trains, "大阪", "京都", 615)).toHaveLength(1);
  });

  it("chooses the nearest station that still has a direct train", () => {
    const nearest = nearestDirectOrigin(
      trains,
      catalog,
      "京都",
      600,
      [135.5011, 34.7011],
    );
    expect(nearest?.stationName).toBe("新大阪");
    expect(nearest?.distanceMeters).toBeLessThan(20);
  });

  it("returns no nearest station when there is no direct candidate", () => {
    expect(
      nearestDirectOrigin(trains, catalog, "東京", 600, [135.5, 34.7]),
    ).toBeUndefined();
  });

  it("chooses a nearby departure station without requiring a direct train", () => {
    const nearest = nearestOriginWithDepartures(
      trains,
      catalog,
      600,
      [135.5011, 34.7011],
    );

    expect(nearest?.stationName).toBe("新大阪");
    expect(nearest?.distanceMeters).toBeLessThan(20);
  });
});
