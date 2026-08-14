import { describe, expect, it } from "vitest";

import type { Train } from "../data/train-index";
import { mergeSameOperationTrains } from "./train-detail-service";

describe("train detail service", () => {
  it("joins split sections into one timetable without exposing another train number", () => {
    const first = train("section-a", "783T", "大阪", "姫路", [
      ["大阪", 600],
      ["姫路", 660],
    ]);
    const continuation = train("section-b", "783T", "姫路", "播州赤穂", [
      ["姫路", 660],
      ["相生", 675],
      ["播州赤穂", 690],
    ]);

    const merged = mergeSameOperationTrains([continuation, first], first);

    expect(merged.train_no).toBe("783T");
    expect(merged.origin_station).toBe("大阪");
    expect(merged.destination_station).toBe("播州赤穂");
    expect(merged.stops.map(({ station_name }) => station_name)).toEqual([
      "大阪",
      "姫路",
      "相生",
      "播州赤穂",
    ]);
  });
});

function train(
  serviceUid: string,
  trainNo: string,
  origin: string,
  destination: string,
  stops: Array<[string, number]>,
): Train {
  return {
    service_uid: serviceUid,
    train_no: trainNo,
    service_type: "新快速",
    train_name: "",
    origin_station: origin,
    destination_station: destination,
    stops: stops.map(([station_name, route_time_minutes]) => ({
      station_name,
      route_time_minutes,
    })),
  };
}
