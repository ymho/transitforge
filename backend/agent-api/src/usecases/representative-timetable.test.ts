import { describe, expect, it } from "vitest";

import { searchRepresentativeTimetable } from "./representative-timetable.js";

describe("representative timetable search", () => {
  it("matches the existing bounded response contract", async () => {
    const timetable = {
      schema_version: "ai-timetable-v1", service_date: "2026-07-31", timetable_kind: "weekday",
      trains: [{ service_uid: "service-1", train_no: "101M", service_type: "特急", train_name: "はるか16号", origin_station: "関西空港", destination_station: "京都", stops: [
        { station_name: "大阪", event: "着", route_time_minutes: 600 },
        { station_name: "大阪", event: "発", route_time_minutes: 602 },
      ] }],
    };
    const result = await searchRepresentativeTimetable({ load: async () => timetable }, {
      timetableKind: "weekday", query: "平日の10時ごろ大阪に着く特急", mode: "arrivals", targetTimeMinutes: 600,
    });
    expect(result).toEqual({ timetableKind: "weekday", serviceDate: "2026-07-31", mode: "arrivals", targetTimeMinutes: 600, totalMatchCount: 1, matches: [{ trainNumber: "101M", serviceType: "特急", trainName: "はるか16号", origin: "関西空港", destination: "京都", matchingStops: [{ stationName: "大阪", event: "着", routeTimeMinutes: 600 }] }] });
  });
});
