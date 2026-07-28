import { describe, expect, it } from "vitest";

import type { StationLineCatalog } from "../data/station-line-catalog";
import type { Train } from "../data/train-index";
import { TrainLineColorIndex } from "./train-line-color";

const catalog: StationLineCatalog = {
  schema_version: "station-line-catalog-v1",
  source: "test.geojson",
  lines: [
    catalogLine("西日本旅客鉄道", "東海道線", [
      ["西大路", 135.73],
      ["京都", 135.76],
    ]),
    catalogLine("西日本旅客鉄道", "奈良線", [
      ["東福寺", 135.77],
      ["京都", 135.76],
      ["平城山", 135.81],
      ["奈良", 135.82],
    ]),
    catalogLine("西日本旅客鉄道", "山陰線", [
      ["二条", 135.74],
      ["京都", 135.76],
    ]),
    catalogLine("西日本旅客鉄道", "山陽線", [
      ["上郡", 134.35],
      ["岡山", 133.92],
    ]),
    catalogLine("東海旅客鉄道", "東海道線", [
      ["岐阜", 136.72],
      ["名古屋", 136.88],
    ]),
  ],
};

describe("train line colors", () => {
  const colors = new TrainLineColorIndex(catalog);

  it("selects a line shared by the destination using the train stop sequence", () => {
    expect(colors.colorFor(train("京都", ["西大路", "京都"]))).toEqual({
      color: "#007cc3",
      lineName: "琵琶湖線・JR京都線・JR神戸線",
    });
    expect(colors.colorFor(train("京都", ["東福寺", "京都"]))).toEqual({
      color: "#bc7e38",
      lineName: "奈良線",
    });
    expect(colors.colorFor(train("京都", ["二条", "京都"]))).toEqual({
      color: "#7887c3",
      lineName: "嵯峨野線・山陰線",
    });
  });

  it("uses the regional color within a formal line spanning several map areas", () => {
    expect(colors.colorFor(train("岡山", ["上郡", "岡山"]))).toEqual({
      color: "#b0d235",
      lineName: "山陽線（姫路・岡山間）",
    });
  });

  it("uses gray when the supplied maps do not define the selected line color", () => {
    expect(colors.colorFor(train("名古屋", ["岐阜", "名古屋"]))).toEqual({
      color: "#a8aaad",
      lineName: "路線未判定",
    });
  });

  it("identifies Shinkansen before conventional lines at shared stations", () => {
    expect(colors.colorFor({ ...train("京都", ["西大路", "京都"]), service_type: "新幹線" })).toEqual({
      color: "#2b4598",
      lineName: "新幹線",
    });
  });
});

function catalogLine(
  operator: string,
  line: string,
  stations: Array<[name: string, longitude: number]>,
) {
  return {
    operator,
    line,
    stations: stations.map(([name, longitude]) => ({
      name,
      coordinate: [longitude, 35] as [number, number],
    })),
  };
}

function train(destination: string, stationNames: string[]): Train {
  return {
    service_uid: "service",
    train_no: "1",
    service_type: "普通",
    train_name: "",
    origin_station: stationNames[0] ?? "",
    destination_station: destination,
    path_id: "path",
    stops: stationNames.map((station_name) => ({ station_name })),
  };
}
