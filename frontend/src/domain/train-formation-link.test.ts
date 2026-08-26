import { describe, expect, it } from "vitest";

import type { Train } from "@raiquora/train/train";
import { trainFormationLinks } from "./train-formation-link";

describe("train formation links", () => {
  it("links a returning Kansai-airport rapid to its Kishuji rapid formation", () => {
    const airport = train(
      "airport",
      "4206M",
      "関西空港",
      "京橋",
      1_128,
      1_207,
      "関空快速",
    );
    const kishuji = train(
      "kishuji",
      "4606H",
      "和歌山",
      "京橋",
      1_109,
      1_207,
      "紀州路快速",
    );
    airport.stops.splice(1, 0, sharedStop("日根野", 1_142));
    kishuji.stops.splice(1, 0, sharedStop("日根野", 1_142));

    const links = trainFormationLinks([airport, kishuji]);

    expect(links.get("airport")?.partnerServiceUid).toBe("kishuji");
    expect(links.get("kishuji")?.partnerServiceUid).toBe("airport");
  });

  it("does not link rapid services with matching numbers but no shared run", () => {
    const airport = train(
      "airport",
      "4206M",
      "関西空港",
      "京橋",
      1_128,
      1_207,
      "関空快速",
    );
    const kishuji = train(
      "kishuji",
      "4606H",
      "和歌山",
      "天王寺",
      1_300,
      1_400,
      "紀州路快速",
    );

    expect(trainFormationLinks([airport, kishuji]).size).toBe(0);
  });

  it("links a Maibara-bound new rapid to its Nagahama continuation", () => {
    const main = train("main", "3416M", "姫路", "米原", 415, 576);
    const north = train("north", "3216M", "米原", "長浜", 579, 589);

    expect(trainFormationLinks([main, north]).get("main")).toEqual({
      partnerServiceUid: "north",
      partnerTrainNo: "3216M",
      partnerServiceType: "新快速",
      linkKind: "same-operation",
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
  serviceType = "新快速",
): Train {
  return {
    service_uid: serviceUid,
    train_no: trainNo,
    service_type: serviceType,
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

function sharedStop(stationName: string, routeTimeMinutes: number) {
  return {
    station_name: stationName,
    route_time_minutes: routeTimeMinutes,
    route_meter: 0.5,
  };
}
