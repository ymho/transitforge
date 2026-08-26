import { describe, expect, it } from "vitest";

import {
  overallBounds,
  toRouteFeatureCollection,
  toRouteFeatureCollections,
  type PathCatalog,
} from "./path-catalog";

const catalog: PathCatalog = {
  schema_version: "train-path-catalog-v1",
  paths: [
    {
      path_id: "path-a",
      coord_count: 2,
      route_length_m: 100,
      bbox: [134, 34, 135, 35],
      route_coords: [
        [134, 34],
        [135, 35],
      ],
    },
    {
      path_id: "path-b",
      coord_count: 2,
      route_length_m: 100,
      bbox: [133, 36, 136, 37],
      route_coords: [
        [133, 36],
        [136, 37],
      ],
    },
  ],
};

describe("path catalog", () => {
  it("converts every path to a route feature", () => {
    const features = toRouteFeatureCollection(catalog);

    expect(features.features).toHaveLength(2);
    expect(features.features[0]).toEqual({
      type: "Feature",
      properties: { path_id: "path-a" },
      geometry: {
        type: "LineString",
        coordinates: [
          [134, 34],
          [135, 35],
        ],
      },
    });
  });

  it("combines all path bounds", () => {
    expect(overallBounds(catalog)).toEqual([133, 34, 136, 37]);
  });

  it("splits routes into bounded feature collections", () => {
    const collections = toRouteFeatureCollections(catalog, 1);

    expect(collections).toHaveLength(2);
    expect(collections.map((collection) => collection.features)).toEqual([
      [expect.objectContaining({ properties: { path_id: "path-a" } })],
      [expect.objectContaining({ properties: { path_id: "path-b" } })],
    ]);
  });

  it("adds a resolved line color to route features", () => {
    const features = toRouteFeatureCollection(
      catalog,
      new Map([["path-a", "#007cc3"]]),
    );

    expect(features.features[0].properties).toEqual({
      path_id: "path-a",
      line_color: "#007cc3",
    });
    expect(features.features[1].properties).toEqual({ path_id: "path-b" });
  });
});
