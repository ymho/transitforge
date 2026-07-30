import { describe, expect, it } from "vitest";

import { compactTrainIndex } from "./build_runtime_train_index.mjs";

describe("runtime train index builder", () => {
  it("keeps viewer fields and removes source diagnostics", () => {
    expect(
      compactTrainIndex({
        schema_version: "train-index-v1",
        path_catalog: "path_catalog.json",
        source_pages: [{ url: "https://example.invalid" }],
        trains: [
          {
            service_uid: "service-1",
            train_no: "101M",
            service_type: "特急",
            train_name: "はるか16号",
            origin_station: "関西空港",
            destination_station: "京都",
            path_id: "path-1",
            route_builder: { diagnostics: "large" },
            stops: [
              {
                station_name: "京都",
                event: "着",
                time: "18:40",
                normalized_time: "18:40",
                route_meter: 42_000,
                route_time_minutes: 1_120,
                line_name: "東海道線",
              },
            ],
          },
        ],
      }),
    ).toEqual({
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
              time: "18:40",
              normalized_time: "18:40",
              route_meter: 42_000,
              route_time_minutes: 1_120,
            },
          ],
        },
      ],
    });
  });
});
