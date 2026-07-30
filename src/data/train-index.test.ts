import { afterEach, describe, expect, it, vi } from "vitest";

import { loadTrainIndex } from "./train-index";

const index = {
  schema_version: "train-index-v1",
  path_catalog: "path_catalog.json",
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
  it("loads the compact runtime index first", async () => {
    const fetcher = vi.fn(async () => Response.json(index));
    vi.stubGlobal("fetch", fetcher);

    await expect(loadTrainIndex()).resolves.toEqual(index);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      "/viewer-input/train_runtime_index.json",
    );
  });

  it("falls back to the source index when the runtime index is unavailable", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(Response.json(index));
    vi.stubGlobal("fetch", fetcher);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(loadTrainIndex()).resolves.toEqual(index);
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/viewer-input/train_index.json",
    );
  });
});
