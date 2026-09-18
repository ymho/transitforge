import type { Map as MapboxMap } from "mapbox-gl";
import { describe, expect, it, vi } from "vitest";

import type { PlaceMedia } from "@raiquora/trip/place-media";

import { createVerifiedPlaceLayer } from "./place-media-layer";

const place = (providerPlaceId: string, name: string, longitude: number): PlaceMedia => ({
  providerPlaceId,
  name,
  latitude: 35,
  longitude,
  sourceUrl: "https://example.com/place",
  openingHoursStatus: "unknown",
});

function mapFixture() {
  let styleLoaded = false;
  let sourceAdded = false;
  const layers = new Set<string>();
  const styleLoadListeners: Array<() => void> = [];
  const source = { setData: vi.fn() };
  const map = {
    isStyleLoaded: vi.fn(() => styleLoaded),
    getSource: vi.fn(() => sourceAdded ? source : undefined),
    addSource: vi.fn(() => { sourceAdded = true; }),
    getLayer: vi.fn((id: string) => layers.has(id) ? { id } : undefined),
    addLayer: vi.fn((layer: { id: string }) => { layers.add(layer.id); }),
    on: vi.fn((event: string, layerOrListener: string | (() => void)) => {
      if (event === "style.load" && typeof layerOrListener === "function") {
        styleLoadListeners.push(layerOrListener);
      }
      return map;
    }),
    getCanvas: vi.fn(() => ({ style: { cursor: "" } })),
    setConfigProperty: vi.fn(),
    setFeatureState: vi.fn(),
    fitBounds: vi.fn(),
    easeTo: vi.fn(),
    getZoom: vi.fn(() => 10),
  };
  return {
    map: map as unknown as MapboxMap,
    source,
    loadStyle() {
      styleLoaded = true;
      for (const listener of styleLoadListeners) listener();
    },
  };
}

describe("verified place map layer", () => {
  it("hides failed target bindings and focuses only resolved places with the panel offset", () => {
    const fixture = mapFixture();
    const layer = createVerifiedPlaceLayer(fixture.map, vi.fn(), () => [-180, -90]);
    layer.show([
      { ...place("unresolved", "未解決", 135), targetBinding: { status: "unresolved", reason: "missing-binding" } },
      { ...place("mismatch", "別施設", 136), targetBinding: { status: "mismatch", reason: "different-id" } },
      { ...place("resolved", "対象施設", 137), targetBinding: { status: "resolved", reason: "stable-id" } },
    ]);
    fixture.loadStyle();
    expect(fixture.source.setData).toHaveBeenLastCalledWith(expect.objectContaining({
      features: [expect.objectContaining({ properties: { providerPlaceId: "resolved", name: "対象施設" } })],
    }));
    layer.focus("unresolved");
    layer.focus("mismatch");
    expect(fixture.map.easeTo).not.toHaveBeenCalled();
    layer.focus("resolved");
    expect(fixture.map.easeTo).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      center: [137, 35], offset: [-180, -90], zoom: 17.6, pitch: 68,
    }));
  });

  it("defers restored places until the Mapbox style is loaded", () => {
    const fixture = mapFixture();
    const layer = createVerifiedPlaceLayer(fixture.map, vi.fn());

    layer.show([place("old", "以前の候補", 135), place("latest", "最新の候補", 136)]);

    expect(fixture.map.addSource).not.toHaveBeenCalled();
    expect(fixture.map.setConfigProperty).not.toHaveBeenCalled();

    fixture.loadStyle();

    expect(fixture.map.addSource).toHaveBeenCalledOnce();
    expect(fixture.map.addLayer).toHaveBeenCalledTimes(2);
    expect(fixture.source.setData).toHaveBeenCalledWith(expect.objectContaining({
      features: [
        expect.objectContaining({ properties: expect.objectContaining({ providerPlaceId: "old" }) }),
        expect.objectContaining({ properties: expect.objectContaining({ providerPlaceId: "latest" }) }),
      ],
    }));
    expect(fixture.map.fitBounds).toHaveBeenCalledOnce();
  });

  it("keeps only the latest restored candidates before style load", () => {
    const fixture = mapFixture();
    const layer = createVerifiedPlaceLayer(fixture.map, vi.fn());

    layer.show([place("old", "以前の候補", 135)]);
    layer.show([place("latest", "最新の候補", 136)]);
    fixture.loadStyle();

    expect(fixture.source.setData).toHaveBeenCalledWith(expect.objectContaining({
      features: [expect.objectContaining({
        properties: expect.objectContaining({ providerPlaceId: "latest" }),
      })],
    }));
    expect(fixture.map.fitBounds).toHaveBeenCalledOnce();
  });
});
