// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ removed: vi.fn(), added: vi.fn() }));
vi.mock("mapbox-gl", () => {
  class Marker { constructor(public options: unknown) {} setLngLat() { return this; } addTo() { mocks.added(); return this; } remove() { mocks.removed(); } }
  class LngLatBounds { extend() { return this; } }
  return { default: { Marker, LngLatBounds } };
});
import { createTripMapOverlay } from "./trip-map-overlay";

describe("Trip Mapbox overlay", () => {
  beforeEach(() => vi.clearAllMocks());
  it("reuses one overlay and removes stale Trip markers before replacement", () => {
    const map = { easeTo: vi.fn(), fitBounds: vi.fn(), getZoom: () => 8 } as never;
    const overlay = createTripMapOverlay(map, vi.fn());
    const first = [{ itemId: "a", name: "A", longitude: 135, latitude: 35 }];
    overlay.show("trip-a:1", first); overlay.show("trip-a:1", first);
    expect(mocks.added).toHaveBeenCalledTimes(1); expect(mocks.removed).not.toHaveBeenCalled();
    overlay.show("trip-b:0", [{ itemId: "b", name: "B", longitude: 136, latitude: 36 }]);
    expect(mocks.removed).toHaveBeenCalledTimes(1); expect(mocks.added).toHaveBeenCalledTimes(2);
    overlay.destroy(); expect(mocks.removed).toHaveBeenCalledTimes(2);
  });
});
