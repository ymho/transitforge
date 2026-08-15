import { describe, expect, it } from "vitest";

import type { Path } from "../data/path-catalog";
import type { Train } from "../data/train-index";
import {
  activeTrainPositions,
  destinationCoordinateForTrain,
  freezeLongTimeStoppingPositions,
  interpolatedRouteMeter,
  PathGeometryIndex,
  positionForTrain,
} from "./train-position";

const path: Path = {
  path_id: "path-a",
  coord_count: 3,
  route_length_m: 200,
  bbox: [135, 34, 137, 34],
  route_coords: [
    [135, 34],
    [136, 34],
    [137, 34],
  ],
};

const train: Train = {
  service_uid: "service-a",
  train_no: "1A",
  service_type: "普通",
  train_name: "",
  origin_station: "始発駅",
  destination_station: "終着駅",
  path_id: "path-a",
  stops: [
    { route_time_minutes: 1430, route_meter: 0 },
    { route_time_minutes: 1440, route_meter: 100 },
    { route_time_minutes: 1445, route_meter: 100 },
    { route_time_minutes: 1455, route_meter: 200 },
  ],
};

describe("train position", () => {
  it("interpolates movement and keeps a train at its stop", () => {
    expect(interpolatedRouteMeter(train.stops.slice(0, 2), 1435)).toBe(50);
    expect(interpolatedRouteMeter(train.stops, 1442)).toBe(100);
  });

  it("accepts route times after midnight and skips inactive trains", () => {
    const geometry = new PathGeometryIndex([path]);

    expect(positionForTrain(train, geometry, 1429)).toBeUndefined();
    expect(positionForTrain(train, geometry, 1456)).toBeUndefined();
    expect(positionForTrain(train, geometry, 1450)).toMatchObject({
      serviceUid: "service-a",
      coordinate: [136.5, 34],
    });
    expect(positionForTrain(train, geometry, 1450)?.bearingRadians).toBeCloseTo(
      Math.PI / 2,
      1,
    );
  });

  it("places a delayed train at its corresponding earlier timetable time", () => {
    const geometry = new PathGeometryIndex([path]);

    expect(
      activeTrainPositions(
        [train],
        geometry,
        1450,
        new Map([[train.train_no, 10]]),
      )[0],
    ).toMatchObject({ routeMeter: 100, coordinate: [136, 34] });
  });

  it("keeps a long-time-stopping train at its previously displayed position", () => {
    const previous = {
      serviceUid: "service-a",
      trainNo: "1A",
      serviceType: "普通",
      routeMeter: 80,
      coordinate: [135.8, 34] as [number, number],
      bearingRadians: 0,
    };
    const moving = { ...previous, routeMeter: 100, coordinate: [136, 34] as [number, number] };

    expect(freezeLongTimeStoppingPositions(
      [moving],
      [previous],
      new Set(["service-a"]),
    )).toEqual([previous]);
    expect(freezeLongTimeStoppingPositions(
      [moving],
      [previous],
      new Set(),
    )).toEqual([moving]);
    expect(freezeLongTimeStoppingPositions(
      [],
      [previous],
      new Set(["service-a"]),
    )).toEqual([previous]);
    expect(freezeLongTimeStoppingPositions(
      [],
      [previous],
      new Set(["service-a"]),
      new Set(["service-a"]),
    )).toEqual([]);
  });

  it("removes a destination-changed train when it reaches the new destination", () => {
    const geometry = new PathGeometryIndex([path]);
    const changedTrain: Train = {
      ...train,
      destination_station: "途中駅",
      stops: [
        { station_name: "始発駅", route_time_minutes: 600, route_meter: 0 },
        { station_name: "途中駅", route_time_minutes: 630, route_meter: 100 },
      ],
    };
    const changed = new Set([changedTrain.service_uid]);

    expect(activeTrainPositions(
      [changedTrain], geometry, 629, new Map(), changed,
    )).toHaveLength(1);
    expect(activeTrainPositions(
      [changedTrain], geometry, 630, new Map(), changed,
    )).toHaveLength(0);
    expect(activeTrainPositions(
      [changedTrain], geometry, 634, new Map([[changedTrain.train_no, 5]]), changed,
    )).toHaveLength(1);
    expect(activeTrainPositions(
      [changedTrain], geometry, 635, new Map([[changedTrain.train_no, 5]]), changed,
    )).toHaveLength(0);
  });

  it("skips a train without a usable path", () => {
    const geometry = new PathGeometryIndex([path]);
    expect(positionForTrain({ ...train, path_id: undefined }, geometry, 1440)).toBeUndefined();
  });

  it("resolves the destination from the final positioned stop", () => {
    const geometry = new PathGeometryIndex([path]);

    expect(destinationCoordinateForTrain(train, geometry)).toEqual([137, 34]);
    expect(
      destinationCoordinateForTrain(
        {
          ...train,
          stops: [
            { route_meter: 0 },
            { station_name: "途中駅", route_meter: 150 },
            { station_name: "座標なし" },
          ],
        },
        geometry,
      ),
    ).toEqual([136.5, 34]);
  });

  it("resolves a changed destination from its matching stop", () => {
    const geometry = new PathGeometryIndex([path]);

    expect(
      destinationCoordinateForTrain(
        {
          ...train,
          destination_station: "途中駅",
          stops: [
            { station_name: "始発駅", route_meter: 0 },
            { station_name: "途中駅", route_meter: 100 },
            { station_name: "終着駅", route_meter: 200 },
          ],
        },
        geometry,
      ),
    ).toEqual([136, 34]);
  });

  it("ignores a short local reversal when calculating the train bearing", () => {
    const geometry = new PathGeometryIndex([
      {
        path_id: "path-with-local-reversal",
        coord_count: 5,
        route_length_m: 218,
        bbox: [135, 34, 135.002, 34],
        route_coords: [
          [135, 34],
          [135.001, 34],
          [135.0011, 34],
          [135.0009, 34],
          [135.002, 34],
        ],
      },
    ]);

    expect(
      geometry.positionAt("path-with-local-reversal", 109)?.bearingRadians,
    ).toBeCloseTo(Math.PI / 2);
  });

});
