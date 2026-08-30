import { describe, expect, it, vi } from "vitest";
import { MapboxGroundAccessProvider } from "./mapbox-ground-access-provider.js";

const origin = { entityId: "station:京都", name: "京都", latitude: 34.985, longitude: 135.758 };
const destination = { entityId: "mapbox:temple", name: "寺院", latitude: 34.99, longitude: 135.77 };
const credentials = { load: vi.fn(async () => ({ accessToken: "token" })) };

describe("MapboxGroundAccessProvider", () => {
  it("徒歩経路を分数とGeoJSON座標へ正規化する", async () => {
    const fetch = vi.fn(async (_input: string) => Response.json({ routes: [{ duration: 720, distance: 950.4, geometry: { coordinates: [[135.758, 34.985], [135.77, 34.99]] } }] }));
    const result = await new MapboxGroundAccessProvider({ fetch }, credentials, () => new Date("2026-08-30T00:00:00Z")).route(origin, destination, "walking");
    expect(result.data).toMatchObject({ durationMinutes: 12, distanceMeters: 950, mode: "walking" });
    expect(fetch.mock.calls[0]?.[0]).toContain("/directions/v5/mapbox/walking/");
  });

  it("複数候補の所要時間をMatrixで比較する", async () => {
    const fetch = vi.fn(async (_input: string) => Response.json({ durations: [[0, 600]], distances: [[0, 800]] }));
    const result = await new MapboxGroundAccessProvider({ fetch }, credentials).matrix(origin, [destination], "walking");
    expect(result.data?.entries[0]).toMatchObject({ durationMinutes: 10, distanceMeters: 800 });
  });

  it("到達圏Polygonを上限付きで返す", async () => {
    const fetch = vi.fn(async (_input: string) => Response.json({ features: [{ geometry: { coordinates: [[[135.7, 34.9], [135.8, 34.9], [135.8, 35], [135.7, 34.9]]] } }] }));
    const result = await new MapboxGroundAccessProvider({ fetch }, credentials).isochrone(origin, 15, "walking");
    expect(result.data).toMatchObject({ minutes: 15, polygons: [expect.any(Array)] });
  });
});
