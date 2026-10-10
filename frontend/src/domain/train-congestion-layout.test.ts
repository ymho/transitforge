import { describe, expect, it } from "vitest";
import { coupledTrainLayouts } from "./coupled-train-layout";
import type { TrainPosition } from "./train-position";
import { congestionBarsForLayouts } from "./train-congestion-layout";

function position(serviceUid: string, trainNo: string, serviceType: string, longitude = 135.5): TrainPosition {
  return { serviceUid, trainNo, serviceType, coordinate: [longitude, 34.7], routeMeter: 500, bearingRadians: 0 };
}

describe("train congestion layout", () => {
  const airport = position("airport", "4237M", "関空快速");
  const kishuji = position("kishuji", "4637H", "紀州路快速");

  it("draws one centered bar for shared formation data, regardless of layout order", () => {
    for (const positions of [[airport, kishuji], [kishuji, airport]]) {
      const bars = congestionBarsForLayouts(coupledTrainLayouts(positions), new Map([["4237M", 339], ["4637H", 100]]));
      expect([...bars]).toEqual([["airport", { congestion: 339, centered: true }]]);
    }
  });

  it("finds the shared data on either partner, including zero congestion", () => {
    expect([...congestionBarsForLayouts(coupledTrainLayouts([airport, kishuji]), new Map([["4637H", 0]]))])
      .toEqual([["airport", { congestion: 0, centered: true }]]);
  });

  it("matches M suffix variants for airport and combined services", () => {
    for (const serviceType of ["関空快速", "関空紀州路快速"]) {
      for (const [trainNo, feedNo] of [["4239M", "4239"], ["4239", "4239M"]]) {
        expect([...congestionBarsForLayouts(coupledTrainLayouts([position("a", trainNo, serviceType)]), new Map([[feedNo, 109]]))])
          .toEqual([["a", { congestion: 109, centered: false }]]);
      }
    }
  });

  it("prefers exact numbers and does not alias unrelated services", () => {
    expect(congestionBarsForLayouts(coupledTrainLayouts([airport]), new Map([["4237M", 50], ["4237", 100]])).get("airport")?.congestion).toBe(50);
    expect(congestionBarsForLayouts(coupledTrainLayouts([position("a", "4237M", "普通")]), new Map([["4237", 100]])).size).toBe(0);
  });

  it("keeps separate bars after uncoupling and omits missing data", () => {
    const layouts = coupledTrainLayouts([airport, { ...kishuji, coordinate: [135.6, 34.7] }]);
    expect([...congestionBarsForLayouts(layouts, new Map([["4237M", 50], ["4637H", 100]]))]).toEqual([
      ["airport", { congestion: 50, centered: false }], ["kishuji", { congestion: 100, centered: false }],
    ]);
    expect(congestionBarsForLayouts(layouts, new Map()).size).toBe(0);
  });
});
