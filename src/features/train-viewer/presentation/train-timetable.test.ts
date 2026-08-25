import { describe, expect, it } from "vitest";

import {
  timetableDisplayTimeParts,
  timetableProgressRowsFor,
  timetableRowsFor,
} from "./train-timetable";

describe("train timetable rows", () => {
  it("separates a clock from its compact arrival or departure suffix", () => {
    expect(timetableDisplayTimeParts("着 10:15")).toEqual({
      clock: "10:15",
      event: "着",
    });
    expect(timetableDisplayTimeParts("10:16")).toEqual({ clock: "10:16" });
  });

  it("groups consecutive arrival and departure records for the same station", () => {
    expect(
      timetableRowsFor([
        { station_name: "新大阪", event: "着", normalized_time: "24:10" },
        { station_name: "新大阪", event: "発", normalized_time: "24:12" },
        { station_name: "大阪", event: "着", normalized_time: "24:16" },
      ]),
    ).toEqual([
      { stationName: "新大阪", times: ["着 24:10", "発 24:12"] },
      { stationName: "大阪", times: ["着 24:16"] },
    ]);
  });

  it("falls back to the raw or numeric route time when normalized time is absent", () => {
    expect(
      timetableRowsFor([
        { station_name: "京都", event: "発", time: "23:58" },
        { station_name: "高槻", route_time_minutes: 1_460 },
        {},
      ]),
    ).toEqual([
      { stationName: "京都", times: ["発 23:58"] },
      { stationName: "高槻", times: ["24:20"] },
      { stationName: "駅名不明", times: ["—"] },
    ]);
  });

  it("finds the approaching station from route distance rather than time", () => {
    expect(
      timetableProgressRowsFor(
        [
          { station_name: "大阪", route_meter: 0, route_time_minutes: 600 },
          { station_name: "新大阪", route_meter: 4_000, route_time_minutes: 605 },
          { station_name: "京都", route_meter: 40_000, route_time_minutes: 630 },
        ],
        2_000,
        undefined,
      ).map(({ stationName, status }) => ({ stationName, status })),
    ).toEqual([
      { stationName: "大阪", status: undefined },
      { stationName: "新大阪", status: "approaching" },
      { stationName: "京都", status: undefined },
    ]);
  });

  it("marks a stop and adjusts only its remaining timetable", () => {
    expect(
      timetableProgressRowsFor(
        [
          { station_name: "大阪", event: "発", route_meter: 0, route_time_minutes: 600 },
          { station_name: "新大阪", event: "着", route_meter: 4_000, route_time_minutes: 605 },
          { station_name: "新大阪", event: "発", route_meter: 4_000, route_time_minutes: 607 },
          { station_name: "京都", event: "着", route_meter: 40_000, route_time_minutes: 630 },
        ],
        4_000,
        8,
      ),
    ).toEqual([
      { stationName: "大阪", times: [{ scheduled: "発 10:00" }] },
      {
        stationName: "新大阪",
        status: "stopped",
        times: [
          { scheduled: "着 10:05", adjusted: "着 10:13" },
          { scheduled: "発 10:07", adjusted: "発 10:15" },
        ],
      },
      {
        stationName: "京都",
        times: [{ scheduled: "着 10:30", adjusted: "着 10:38" }],
      },
    ]);
  });
});
