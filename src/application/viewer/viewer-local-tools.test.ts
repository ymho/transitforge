import { describe, expect, it } from "vitest";

import type { Train } from "../../domain/rail/train";
import type { TrainPosition } from "../../domain/train-position";
import {
  directRouteRequestFromPrompt,
  formatStationLabel,
  localViewerControlActionsFromPrompt,
  routeCalendarDateFromPrompt,
  routeTimeFromPrompt,
  searchActiveTrainsFromPrompt,
  searchTrainArrivalsFromPrompt,
} from "./viewer-local-tools";

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
  routeMeter: index * 100,
  coordinate: [135 + index, 34],
  bearingRadians: 0,
}));

describe("viewer agent local tools", () => {
  it("formats station labels without duplicating the station suffix", () => {
    expect(formatStationLabel("西大路")).toBe("西大路駅");
    expect(formatStationLabel("西大路駅")).toBe("西大路駅");
  });

  it("extracts Japanese and colon display times", () => {
    expect(routeTimeFromPrompt("18時30分にして")).toBe(1_110);
    expect(routeTimeFromPrompt("表示を 25:05 にして")).toBe(1_505);
    expect(routeTimeFromPrompt("0時30分にして")).toBe(1_470);
    expect(routeTimeFromPrompt("03:59にして")).toBe(1_679);
    expect(routeTimeFromPrompt("4時にして")).toBe(240);
    expect(routeTimeFromPrompt("18時99分")).toBeUndefined();
  });

  it("maps a calendar date to the generated service date", () => {
    const now = new Date("2026-08-14T12:00:00+09:00");

    expect(routeCalendarDateFromPrompt("京都に行きたい", 420, now)).toEqual({
      departureDate: "2026-08-14",
      serviceDate: "2026-08-14",
    });
    expect(routeCalendarDateFromPrompt("8/15の7:00", 420, now)).toEqual({
      departureDate: "2026-08-15",
      serviceDate: "2026-08-15",
    });
    expect(routeCalendarDateFromPrompt("8/15の2:00", 1_560, now)).toEqual({
      departureDate: "2026-08-15",
      serviceDate: "2026-08-14",
    });
    expect(routeCalendarDateFromPrompt("明日の7時", 420, now)).toEqual({
      departureDate: "2026-08-15",
      serviceDate: "2026-08-15",
    });
  });

  it("resolves a year boundary without selecting a timetable kind", () => {
    expect(
      routeCalendarDateFromPrompt(
        "1月1日の7時",
        420,
        new Date("2026-12-31T12:00:00+09:00"),
      ),
    ).toEqual({ departureDate: "2027-01-01", serviceDate: "2027-01-01" });
  });

  it("extracts direct-route destinations and optional origins", () => {
    const airportRoute = train("airport", "1001M", "特急", "はるか1号", "関西空港", [
      ["姫路", 720],
      ["関西空港", 840],
    ]);
    const routeTrains = [...trains, airportRoute];

    expect(directRouteRequestFromPrompt("京都に行きたい", trains)).toEqual({
      destinationStation: "京都",
    });
    expect(
      directRouteRequestFromPrompt("大阪駅から京都駅に18時30分に行きたい", trains),
    ).toEqual({
      originStation: "大阪",
      destinationStation: "京都",
      departureTimeMinutes: 1_110,
    });
    expect(
      directRouteRequestFromPrompt(
        "いまから姫路から関西空港にいきたい",
        routeTrains,
      ),
    ).toEqual({
      originStation: "姫路",
      destinationStation: "関西空港",
    });
    expect(
      directRouteRequestFromPrompt("これから関西空港に行きたい", routeTrains),
    ).toEqual({
      destinationStation: "関西空港",
    });
    expect(
      directRouteRequestFromPrompt("鈍行で京都にいきたい", routeTrains),
    ).toEqual({
      destinationStation: "京都",
    });
    expect(
      directRouteRequestFromPrompt("はるかで関西空港へ", routeTrains),
    ).toEqual({
      destinationStation: "関西空港",
    });
    expect(directRouteRequestFromPrompt("京都へ向かう特急を見せて", trains)).toBeUndefined();
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
        "雨にして目的地アーチを表示して",
      ),
    ).toEqual([
      { type: "set_weather", weather: "rain" },
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
