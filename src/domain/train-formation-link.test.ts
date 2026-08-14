import { describe, expect, it } from "vitest";

import type { Train } from "../data/train-index";
import { trainFormationLinks } from "./train-formation-link";

describe("train formation links", () => {
  it("links a Maibara-bound new rapid to its Nagahama continuation", () => {
    const main = train("main", "3416M", "姫路", "米原", 415, 576);
    const north = train("north", "3216M", "米原", "長浜", 579, 589);

    expect(trainFormationLinks([main, north]).get("main")).toEqual({
      partnerServiceUid: "north",
      partnerTrainNo: "3216M",
      partnerServiceType: "新快速",
      linkKind: "coupled-service",
    });
  });

  it("links a southbound northern section after cars are added at Maibara", () => {
    const north = train("north", "3209M", "敦賀", "米原", 330, 383);
    const main = train("main", "3409M", "米原", "姫路", 386, 550);

    expect(trainFormationLinks([north, main]).get("main")?.partnerServiceUid).toBe(
      "north",
    );
    expect(trainFormationLinks([north, main]).has("north")).toBe(false);
  });

  it("does not infer a formation from a close but unrelated connection", () => {
    const arriving = train("arriving", "3416M", "姫路", "米原", 415, 576);
    const unrelated = train("unrelated", "3299M", "米原", "長浜", 579, 589);

    expect(trainFormationLinks([arriving, unrelated]).size).toBe(0);
  });
});

function train(
  serviceUid: string,
  trainNo: string,
  origin: string,
  destination: string,
  departure: number,
  arrival: number,
): Train {
  return {
    service_uid: serviceUid,
    train_no: trainNo,
    service_type: "新快速",
    train_name: "",
    origin_station: origin,
    destination_station: destination,
    path_id: "path",
    stops: [
      { station_name: origin, route_time_minutes: departure, route_meter: 0 },
      { station_name: destination, route_time_minutes: arrival, route_meter: 1 },
    ],
  };
}
