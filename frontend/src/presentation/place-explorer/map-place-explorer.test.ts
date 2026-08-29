import { describe, expect, it } from "vitest";
import type { PlaceMedia } from "@raiquora/trip/place-media";
import { mapPlaceCardModels } from "./map-place-explorer";

const place = (overrides: Partial<PlaceMedia> = {}): PlaceMedia => ({
  providerPlaceId: "place-1",
  name: "出雲大社",
  latitude: 35.402,
  longitude: 132.685,
  sourceUrl: "https://example.com/place-1",
  openingHoursStatus: "unknown",
  ...overrides,
});

describe("map place card models", () => {
  it("keeps only places that can be shown on the map", () => {
    expect(mapPlaceCardModels([
      place(),
      place({ providerPlaceId: "missing-coordinate", latitude: undefined }),
    ])).toHaveLength(1);
  });

  it("uses an image only when hotlinking is explicitly allowed", () => {
    const image = { url: "https://example.com/image.jpg", attribution: "Example", hotlinkAllowed: true as const };
    expect(mapPlaceCardModels([place({ image })])[0]?.image).toEqual({ url: image.url, attribution: image.attribution });
    expect(mapPlaceCardModels([place({ image: { ...image, hotlinkAllowed: "unknown" } })])[0]?.image).toBeUndefined();
  });
});
