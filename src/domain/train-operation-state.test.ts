import { describe, expect, it } from "vitest";

import type { TrainDelaySnapshot, TrainOperation } from "../data/train-delay";
import type { Train } from "../data/train-index";
import {
  delayByTrainNumber,
  destinationChangedServiceUids,
  operationsForDisplay,
  trainsForOperations,
} from "./train-operation-state";

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
});

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

function train(trainNumber: string, destination: string): Train {
  return {
    service_uid: `service-${trainNumber}`,
    train_no: trainNumber,
    service_type: "普通",
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
