import { describe, expect, it } from "vitest";

import type { Path } from "../data/path-catalog";
import type { Train } from "../data/train-index";
import {
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
    expect(positionForTrain(train, geometry, 1450)?.bearingRadians).toBeCloseTo(Math.PI / 2);
  });

  it("skips a train without a usable path", () => {
    const geometry = new PathGeometryIndex([path]);
    expect(positionForTrain({ ...train, path_id: undefined }, geometry, 1440)).toBeUndefined();
  });

});
