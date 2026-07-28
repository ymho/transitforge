import { describe, expect, it } from "vitest";

import type { TrainPosition } from "./train-position";
import { coupledTrainLayouts } from "./coupled-train-layout";

describe("coupled train layout", () => {
  it("joins matching Kansai-airport and Kishuji rapid services into one train length", () => {
    const layouts = coupledTrainLayouts([
      position("airport", "4107M", "関空快速", [135.5, 34.7]),
      position("kishuji", "4507H", "紀州路快速", [135.5, 34.7]),
    ]);

    expect(layouts).toEqual([
      expect.objectContaining({
        lengthScale: 0.5,
        longitudinalOffsetInVehicleLengths: 0.25,
        coupledServiceUid: "kishuji",
      }),
      expect.objectContaining({
        lengthScale: 0.5,
        longitudinalOffsetInVehicleLengths: -0.25,
        coupledServiceUid: "airport",
      }),
    ]);
    expect(layouts.reduce((sum, layout) => sum + layout.lengthScale, 0)).toBe(1);
    expect(layouts[0].renderCoordinate).toEqual(layouts[1].renderCoordinate);
    expect(layouts[0].renderBearingRadians).toBe(layouts[1].renderBearingRadians);
    expect(layouts[0].bearingTrackingKey).toBe(layouts[1].bearingTrackingKey);
    expect(layouts[0].overlapOffsetMeters).toEqual(
      layouts[1].overlapOffsetMeters,
    );
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
    coordinate,
    bearingRadians: 0,
  };
}
