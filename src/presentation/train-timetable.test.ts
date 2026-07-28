import { describe, expect, it } from "vitest";

import { timetableRowsFor } from "./train-timetable";

describe("train timetable rows", () => {
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
});
