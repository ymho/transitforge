import { describe, expect, it } from "vitest";

import type { TrainPosition } from "./train-position";
import {
  coupledTrainLayouts,
  trainHitTargetsFor,
} from "./coupled-train-layout";

describe("coupled train layout", () => {
  it("joins matching rapid services within one train body's total length", () => {
    const layouts = coupledTrainLayouts([
      position("airport", "4107M", "関空快速", [135.5, 34.7]),
      position("kishuji", "4507H", "紀州路快速", [135.5, 34.7]),
    ]);

    expect(layouts).toEqual([
      expect.objectContaining({
        lengthScale: 0.5,
        longitudinalOffsetInVehicleLengths: 0.25,
        coupledServiceUid: "kishuji",
        linkKind: "coupled-service",
      }),
      expect.objectContaining({
        lengthScale: 0.5,
        longitudinalOffsetInVehicleLengths: -0.25,
        coupledServiceUid: "airport",
        linkKind: "coupled-service",
      }),
    ]);
    expect(layouts.reduce((sum, layout) => sum + layout.lengthScale, 0)).toBe(1);
    expect(layouts[0].renderCoordinate).toEqual(layouts[1].renderCoordinate);
    expect(layouts[0].renderBearingRadians).toBe(layouts[1].renderBearingRadians);
    expect(layouts[0].bearingTrackingKey).toBe(layouts[1].bearingTrackingKey);
    expect(layouts[0].overlapOffsetMeters).toEqual(
      layouts[1].overlapOffsetMeters,
    );
    expect(trainHitTargetsFor(layouts)).toEqual([
      {
        serviceUid: "airport",
        coordinate: layouts[0].renderCoordinate,
      },
    ]);
  });

  it("joins split services within one train body's total length", () => {
    const layouts = coupledTrainLayouts([
      position("section-a", "783T", "普通", [135.5, 34.7]),
      position("section-b", "783T", "普通", [135.5, 34.7]),
    ]);

    expect(layouts).toEqual([
      expect.objectContaining({
        lengthScale: 0.5,
        coupledServiceUid: "section-b",
        linkKind: "same-operation",
      }),
      expect.objectContaining({
        lengthScale: 0.5,
        coupledServiceUid: "section-a",
        linkKind: "same-operation",
      }),
    ]);
    expect(layouts[0].bearingTrackingKey).toBe(layouts[1].bearingTrackingKey);
  });

  it("adds a linked formation section at the active train position", () => {
    const layouts = coupledTrainLayouts(
      [position("main", "3416M", "新快速", [135.5, 34.7])],
      new Map([
        [
          "main",
          {
            partnerServiceUid: "north",
            partnerTrainNo: "3216M",
            partnerServiceType: "新快速",
            linkKind: "coupled-service" as const,
          },
        ],
      ]),
    );

    expect(layouts).toEqual([
      expect.objectContaining({
        position: expect.objectContaining({ serviceUid: "main" }),
        lengthScale: 0.5,
        coupledServiceUid: "north",
      }),
      expect.objectContaining({
        position: expect.objectContaining({
          serviceUid: "north",
          trainNo: "3216M",
        }),
        lengthScale: 0.5,
        coupledServiceUid: "main",
      }),
    ]);
  });

  it("does not add a formation partner outside the shared route range", () => {
    const layouts = coupledTrainLayouts(
      [position("airport", "4206M", "関空快速", [135.5, 34.7])],
      new Map([
        [
          "airport",
          {
            partnerServiceUid: "kishuji",
            partnerTrainNo: "4606H",
            partnerServiceType: "紀州路快速",
            linkKind: "coupled-service" as const,
            activeRouteMeterRange: [200, 500] as const,
          },
        ],
      ]),
    );

    expect(layouts).toHaveLength(1);
    expect(layouts[0].coupledServiceUid).toBeUndefined();
  });

  it("does not join duplicate train numbers at different positions", () => {
    const layouts = coupledTrainLayouts([
      position("section-a", "12M", "特急", [135.5, 34.7]),
      position("unrelated", "12M", "特急", [136.5, 35.1]),
    ]);

    expect(layouts.every(({ lengthScale }) => lengthScale === 1)).toBe(true);
    expect(layouts.every(({ linkKind }) => linkKind === undefined)).toBe(true);
  });

  it("does not join services with unrelated train numbers", () => {
    const layouts = coupledTrainLayouts([
      position("airport", "4107M", "関空快速", [135.5, 34.7]),
      position("kishuji", "4515H", "紀州路快速", [135.5, 34.7]),
    ]);

    expect(layouts.every(({ lengthScale }) => lengthScale === 1)).toBe(true);
  });

  it("separates a matching pair after their positions diverge", () => {
    const layouts = coupledTrainLayouts([
      position("airport", "4107M", "関空快速", [135.5, 34.7]),
      position("kishuji", "4507H", "紀州路快速", [135.51, 34.7]),
    ]);

    expect(layouts.every(({ lengthScale }) => lengthScale === 1)).toBe(true);
  });

  it("gives unrelated overlapping trains stable separate render planes", () => {
    const layouts = coupledTrainLayouts([
      position("first", "100M", "普通", [135.5, 34.7]),
      position("second", "200M", "普通", [135.5, 34.7]),
    ]);

    expect(layouts[0].overlapOffsetMeters).not.toEqual(
      layouts[1].overlapOffsetMeters,
    );
    expect(layouts.every(({ lengthScale }) => lengthScale === 1)).toBe(true);
  });
});

function position(
  serviceUid: string,
  trainNo: string,
  serviceType: string,
  coordinate: [number, number],
): TrainPosition {
  return {
    serviceUid,
    trainNo,
    serviceType,
    routeMeter: 100,
    coordinate,
    bearingRadians: 0,
  };
}
