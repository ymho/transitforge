import { afterEach, describe, expect, it, vi } from "vitest";

import { loadTrainIndex } from "./train-index";

const index = {
  schema_version: "train-index-v1",
  path_catalog: "path_catalog.json",
  service_date: "2026-08-01",
  timetable_kind: "weekend_holiday",
  station_line_catalog: {
    schema_version: "station-line-catalog-v1",
    source: "N02-25_Station.geojson",
    lines: [],
  },
  trains: [
    {
      service_uid: "service-1",
      train_no: "101M",
      service_type: "特急",
      train_name: "はるか16号",
      origin_station: "関西空港",
      destination_station: "京都",
      path_id: "path-1",
      stops: [
        {
          station_name: "京都",
          event: "着",
          route_time_minutes: 1_120,
        },
      ],
    },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("train index loader", () => {
  it("loads the viewer train index", async () => {
    const fetcher = vi.fn(async () => Response.json(index));
    vi.stubGlobal("fetch", fetcher);

    await expect(loadTrainIndex()).resolves.toEqual(index);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("/viewer-input/train_index.json");
  });
});
