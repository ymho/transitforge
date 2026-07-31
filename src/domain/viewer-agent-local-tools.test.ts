import { describe, expect, it } from "vitest";

import type { Train } from "../data/train-index";
import type { TrainPosition } from "./train-position";
import {
  localViewerControlActionsFromPrompt,
  routeTimeFromPrompt,
  searchActiveTrainsFromPrompt,
  searchTrainArrivalsFromPrompt,
} from "./viewer-agent-local-tools";

const trains: Train[] = [
  train("special", "101M", "特急", "はるか16号", "京都", [
    ["大阪", 1_070],
    ["京都", 1_120],
  ]),
  train("local", "202M", "普通", "", "京都", [
    ["大阪", 1_060],
    ["京都", 1_130],
  ]),
  train("departed", "303M", "特急", "まいづる5号", "東舞鶴", [
    ["京都", 1_050],
    ["東舞鶴", 1_140],
  ]),
];

const positions: TrainPosition[] = trains.map((item, index) => ({
  serviceUid: item.service_uid,
  trainNo: item.train_no,
  serviceType: item.service_type,
  coordinate: [135 + index, 34],
  bearingRadians: 0,
}));

describe("viewer agent local tools", () => {
  it("extracts Japanese and colon display times", () => {
    expect(routeTimeFromPrompt("18時30分にして")).toBe(1_110);
    expect(routeTimeFromPrompt("表示を 25:05 にして")).toBe(1_505);
    expect(routeTimeFromPrompt("18時99分")).toBeUndefined();
  });

  it("searches active trains by remaining station and service type", () => {
    const response = searchActiveTrainsFromPrompt(
      "18時30分に京都へ向かう特急を見せて",
      trains,
      positions,
      1_110,
    );

    expect(response.hasSearchTerms).toBe(true);
    expect(response.matches.map(({ train }) => train.service_uid)).toEqual([
      "special",
    ]);
  });

  it("searches by a named service without requiring the complete number", () => {
    const response = searchActiveTrainsFromPrompt(
      "はるかを見せて",
      trains,
      positions,
      1_100,
    );

    expect(response.matches[0]?.train.service_uid).toBe("special");
  });

  it("does not treat a time-only request as a train search", () => {
    expect(
      searchActiveTrainsFromPrompt(
        "19時にして",
        trains,
        positions,
        1_140,
      ),
    ).toEqual({
      hasSearchTerms: false,
      matches: [],
      totalMatchCount: 0,
    });
  });

  it("searches arrivals within 30 minutes of the requested time", () => {
    const response = searchTrainArrivalsFromPrompt(
      "18時30分ごろ京都に着く特急はありますか",
      trains,
    );

    expect(response.windowMinutes).toBe(30);
    expect(response.matches.map(({ train }) => train.service_uid)).toEqual([
      "special",
    ]);
    expect(response.matches[0]?.arrivalTimeMinutes).toBe(1_120);
  });

  it("does not include arrivals outside the 30 minute window", () => {
    const response = searchTrainArrivalsFromPrompt(
      "16時30分ごろ京都に着く特急はありますか",
      trains,
    );

    expect(response.hasSearchTerms).toBe(true);
    expect(response.matches).toEqual([]);
  });

  it("recognizes reversible map controls in the local fallback", () => {
    expect(localViewerControlActionsFromPrompt("雨にして")).toEqual([
      { type: "set_weather", weather: "rain" },
    ]);
    expect(localViewerControlActionsFromPrompt("雲を表示して")).toEqual([
      { type: "set_weather", weather: "cloudy" },
    ]);
    expect(
      localViewerControlActionsFromPrompt(
        "模型モードにして目的地アーチを表示して",
      ),
    ).toEqual([
      { type: "set_scene_mode", sceneMode: "model" },
      {
        type: "set_layer_visibility",
        layer: "destination_arcs",
        visible: true,
      },
    ]);
  });
});

function train(
  serviceUid: string,
  trainNo: string,
  serviceType: string,
  trainName: string,
  destination: string,
  stops: Array<[stationName: string, routeTimeMinutes: number]>,
): Train {
  return {
    service_uid: serviceUid,
    train_no: trainNo,
    service_type: serviceType,
    train_name: trainName,
    origin_station: stops[0]?.[0] ?? "",
    destination_station: destination,
    path_id: "path",
    stops: stops.map(([station_name, route_time_minutes]) => ({
      station_name,
      event: "着",
      route_time_minutes,
    })),
  };
}
