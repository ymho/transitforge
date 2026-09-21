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
    const map = { easeTo: vi.fn(), fitBounds: vi.fn(), getZoom: () => 8, getLayer: vi.fn(), getSource: vi.fn(),
      addSource: vi.fn(), addLayer: vi.fn(), removeLayer: vi.fn(), removeSource: vi.fn() } as never;
    const overlay = createTripMapOverlay(map, vi.fn());
    const first = [{ itemId: "a", name: "A", longitude: 135, latitude: 35 }];
    overlay.show("trip-a:1", first); overlay.show("trip-a:1", first);
    expect(mocks.added).toHaveBeenCalledTimes(1); expect(mocks.removed).not.toHaveBeenCalled();
    overlay.show("trip-b:0", [{ itemId: "b", name: "B", longitude: 136, latitude: 36 }]);
    expect(mocks.removed).toHaveBeenCalledTimes(1); expect(mocks.added).toHaveBeenCalledTimes(2);
    overlay.destroy(); expect(mocks.removed).toHaveBeenCalledTimes(2);
  });
  it("draws confirmed route geometry and replaces its source with the Trip", () => {
    const layers = new Set<string>(), sources = new Set<string>();
    const fake = { easeTo: vi.fn(), fitBounds: vi.fn(), getZoom: () => 8,
      getLayer: vi.fn((id) => layers.has(id)), getSource: vi.fn((id) => sources.has(id)),
      addSource: vi.fn((id) => sources.add(id)), addLayer: vi.fn((layer) => layers.add(layer.id)),
      removeLayer: vi.fn((id) => layers.delete(id)), removeSource: vi.fn((id) => sources.delete(id)) };
    const overlay = createTripMapOverlay(fake as never, vi.fn());
    overlay.show("a", [], [{ itemId: "rail", coordinates: [[135, 35], [136, 36]] }]);
    expect(fake.addSource).toHaveBeenCalledTimes(1); expect(fake.addLayer).toHaveBeenCalledTimes(1); expect(fake.fitBounds).toHaveBeenCalled();
    overlay.show("b", [], []); expect(fake.removeLayer).toHaveBeenCalledTimes(1); expect(fake.removeSource).toHaveBeenCalledTimes(1);
  });
});
