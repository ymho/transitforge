import { describe, expect, it } from "vitest";

import type { TrainDelaySnapshot, TrainOperation } from "./operation";
import type { Train } from "@raiquora/train/train";
import {
  delayByTrainNumber,
  destinationChangedServiceUids,
  operationsForDisplay,
  operationsWithCoupledTrainOperations,
  operationsWithTimetableTrainNumberAliases,
  trainsForOperations,
} from "./train-operation-state";
import type { TrainFormationOperationLink } from "./train-operation-state";

describe("train operation state", () => {
  const now = new Date("2026-08-14T12:00:00+09:00");

  it("uses only a complete fresh snapshot near the displayed time", () => {
    const snapshot = operationSnapshot("2026-08-14T03:00:00.000Z");

    expect(operationsForDisplay(snapshot, now, now, false)).toBe(
      snapshot.operationsByTrainNumber,
    );
    expect(operationsForDisplay(snapshot, now, now, true)).toBeUndefined();
    expect(
      operationsForDisplay(
        snapshot,
        new Date("2026-08-15T12:00:00+09:00"),
        now,
        false,
      ),
    ).toBeUndefined();
    expect(
      operationsForDisplay(
        { ...snapshot, failedSources: ["source-a"] },
        now,
        now,
        false,
      ),
    ).toBeUndefined();
  });

  it("removes unobserved trains and applies an authoritative destination", () => {
    const trains = [train("100A", "姫路"), train("200B", "京都")];
    const operations = new Map<string, TrainOperation>([
      [
        "100A",
        { delayMinutes: 6, destination: "大阪", sources: ["source-a"] },
      ],
    ]);
    const destinationChanges = destinationChangedServiceUids(
      trains,
      operations,
    );

    const displayed = trainsForOperations(trains, operations, destinationChanges);

    expect(displayed).toHaveLength(1);
    expect(displayed[0].destination_station).toBe("大阪");
    expect(displayed[0].stops.map((stop) => stop.station_name)).toEqual([
      "神戸",
      "大阪",
    ]);
    expect(delayByTrainNumber(operations).get("100A")).toBe(6);
    expect(destinationChanges).toEqual(
      new Set(["service-100A"]),
    );
  });

  it("does not mark normal through segments or loop direction labels as changes", () => {
    const throughSegments = [
      train("100A", "大阪"),
      {
        ...train("100A", "姫路"),
        service_uid: "service-100A-continuation",
        origin_station: "大阪",
        stops: [
          { station_name: "大阪", route_meter: 0, route_time_minutes: 631 },
          { station_name: "姫路", route_meter: 1_000, route_time_minutes: 660 },
        ],
      },
    ];
    const throughOperation = new Map<string, TrainOperation>([
      ["100A", { delayMinutes: 0, destination: "姫路", sources: ["source-a"] }],
    ]);
    const loopOperation = new Map<string, TrainOperation>([
      ["100A", { delayMinutes: 0, destination: "大阪", sources: ["osakaloop"] }],
    ]);

    expect(
      destinationChangedServiceUids(throughSegments, throughOperation).size,
    ).toBe(0);
    expect(destinationChangedServiceUids([train("100A", "姫路")], loopOperation).size).toBe(0);
    expect(
      trainsForOperations(throughSegments, throughOperation)[0].stops,
    ).toHaveLength(3);
  });

  it("returns the original timetable without an applicable snapshot", () => {
    const trains = [train("100A", "姫路")];
    expect(trainsForOperations(trains, undefined)).toBe(trains);
    expect(delayByTrainNumber(undefined).size).toBe(0);
  });

  it("matches an Osaka Loop snapshot number without the timetable M suffix", () => {
    const trains = [train("4204M", "京橋", "関空快速")];
    const operation = {
      delayMinutes: 0,
      destination: "天王寺",
      sources: ["osakaloop"],
    };
    const resolved = operationsWithTimetableTrainNumberAliases(
      trains,
      new Map([["4204", operation]]),
    );

    expect(resolved?.get("4204M")).toBe(operation);
    expect(trainsForOperations(trains, resolved)).toHaveLength(1);
    expect(delayByTrainNumber(resolved).get("4204M")).toBe(0);
  });

  it("does not apply the Osaka Loop alias to unrelated timetable trains", () => {
    const trains = [
      train("1512E", "京橋", "関空快速"),
      train("4204M", "京橋", "普通"),
    ];
    const resolved = operationsWithTimetableTrainNumberAliases(
      trains,
      new Map([
        ["1512", { delayMinutes: 0, destination: "京橋", sources: ["osakaloop"] }],
      ]),
    );

    expect(resolved?.has("1512E")).toBe(false);
    expect(resolved?.has("4204M")).toBe(false);
  });

  it("shares the largest delay across a coupled airport and Kishuji formation", () => {
    const airport = coupledTrain("airport", "4127M", "関西空港");
    const kishuji = coupledTrain("kishuji", "4527H", "和歌山");
    const resolved = operationsWithCoupledTrainOperations(
      [airport, kishuji],
      new Map([
        ["4127M", operation(40, "関西空港", "kansaiairport")],
        ["4527H", operation(28, "和歌山", "hanwahagoromo")],
      ]),
      coupledLinks(),
    );

    expect(resolved?.get("4127M")?.delayMinutes).toBe(40);
    expect(resolved?.get("4527H")?.delayMinutes).toBe(40);
    expect(resolved?.get("4127M")?.destination).toBe("関西空港");
    expect(resolved?.get("4527H")?.destination).toBe("和歌山");
  });

  it("supplies a missing coupled operation without inventing a destination change", () => {
    const airport = coupledTrain("airport", "4127M", "関西空港");
    const kishuji = coupledTrain("kishuji", "4527H", "和歌山");
    const resolved = operationsWithCoupledTrainOperations(
      [airport, kishuji],
      new Map([["4127M", operation(12, "関西空港", "kansaiairport")]]),
      coupledLinks(),
    );

    expect(resolved?.get("4527H")).toMatchObject({
      delayMinutes: 12,
      destination: "和歌山",
    });
    expect(destinationChangedServiceUids([airport, kishuji], resolved)).toEqual(
      new Set(),
    );
  });

  it("shares a destination change across both halves of a coupled formation", () => {
    const airport = coupledTrain("airport", "4127M", "関西空港");
    const kishuji = coupledTrain("kishuji", "4527H", "和歌山");
    const resolved = operationsWithCoupledTrainOperations(
      [airport, kishuji],
      new Map([
        ["4127M", operation(12, "天王寺", "kansaiairport")],
        ["4527H", operation(8, "和歌山", "osakaloop")],
      ]),
      coupledLinks(),
    );

    expect(resolved?.get("4127M")?.destination).toBe("天王寺");
    expect(resolved?.get("4527H")?.destination).toBe("天王寺");
    expect(destinationChangedServiceUids([airport, kishuji], resolved)).toEqual(
      new Set(["airport", "kishuji"]),
    );
  });
});

function operation(
  delayMinutes: number,
  destination: string,
  source: string,
): TrainOperation {
  return { delayMinutes, destination, sources: [source] };
}

function coupledTrain(
  serviceUid: string,
  trainNumber: string,
  destination: string,
): Train {
  return {
    ...train(trainNumber, destination, serviceUid === "airport" ? "関空快速" : "紀州路快速"),
    service_uid: serviceUid,
    origin_station: "京橋",
    stops: [
      { station_name: "京橋", route_meter: 0, route_time_minutes: 600 },
      { station_name: "天王寺", route_meter: 500, route_time_minutes: 620 },
      { station_name: "日根野", route_meter: 1_000, route_time_minutes: 650 },
      { station_name: destination, route_meter: 2_000, route_time_minutes: 680 },
    ],
  };
}

function coupledLinks(): ReadonlyMap<string, TrainFormationOperationLink> {
  return new Map([
    [
      "airport",
      {
        partnerServiceUid: "kishuji",
        partnerTrainNo: "4527H",
        partnerServiceType: "紀州路快速",
        linkKind: "coupled-service",
      },
    ],
    [
      "kishuji",
      {
        partnerServiceUid: "airport",
        partnerTrainNo: "4127M",
        partnerServiceType: "関空快速",
        linkKind: "coupled-service",
      },
    ],
  ]);
}

function operationSnapshot(collectedAt: string): TrainDelaySnapshot {
  return {
    collectedAt,
    failedSources: [],
    operationsByTrainNumber: new Map([
      [
        "100A",
        { delayMinutes: 6, destination: "大阪", sources: ["source-a"] },
      ],
    ]),
  };
}

function train(
  trainNumber: string,
  destination: string,
  serviceType = "普通",
): Train {
  return {
    service_uid: `service-${trainNumber}`,
    train_no: trainNumber,
    service_type: serviceType,
    train_name: "",
    origin_station: "神戸",
    destination_station: destination,
    path_id: "path-1",
    stops: [
      { station_name: "神戸", route_meter: 0, route_time_minutes: 600 },
      { station_name: "大阪", route_meter: 1_000, route_time_minutes: 630 },
      { station_name: "姫路", route_meter: 2_000, route_time_minutes: 660 },
    ],
  };
}
