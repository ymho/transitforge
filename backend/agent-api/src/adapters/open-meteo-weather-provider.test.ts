import { describe, expect, it, vi } from "vitest";
import { OpenMeteoWeatherProvider } from "./open-meteo-weather-provider.js";

describe("OpenMeteoWeatherProvider", () => {
  it("normalizes geocoding and forecast responses with evidence", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ id: 1, name: "香港", latitude: 22.3, longitude: 114.2, timezone: "Asia/Hong_Kong" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        timezone: "Asia/Hong_Kong",
        hourly: { time: ["2026-08-27T10:00"], temperature_2m: [26], precipitation_probability: [80], precipitation: [3.2], weather_code: [81] },
        daily: { time: ["2026-08-27"], temperature_2m_min: [23], temperature_2m_max: [27], precipitation_probability_max: [80], precipitation_sum: [8.4], weather_code: [81] },
      }), { status: 200 }));
    const provider = new OpenMeteoWeatherProvider({ fetch }, () => new Date("2026-08-27T00:00:00Z"));
    const result = await provider.search({ location: "香港" });
    expect(result.status).toBe("available");
    expect(result.data?.daily[0]).toEqual(expect.objectContaining({ date: "2026-08-27", maximumPrecipitationProbabilityPercent: 80 }));
    expect(result.evidence[0]).toEqual(expect.objectContaining({ provider: "open-meteo", confidence: "provider-forecast" }));
    expect(fetch.mock.calls[1]?.[0]).toContain("timezone=Asia%2FHong_Kong");
  });

  it("retrieves current conditions for multiple viewer cells in one request", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { current: { time: "2026-08-30T14:00", precipitation: 2.4, weather_code: 61, cloud_cover: 90 } },
      { current: { time: "2026-08-30T14:00", precipitation: 0, weather_code: 2, cloud_cover: 70 } },
    ]), { status: 200 }));
    const provider = new OpenMeteoWeatherProvider(
      { fetch },
      () => new Date("2026-08-30T05:00:00Z"),
    );

    const result = await provider.searchGrid({ points: [
      { id: "0-0", latitude: 34.7, longitude: 135.5 },
      { id: "0-1", latitude: 35.0, longitude: 135.8 },
    ] });

    expect(result.data?.cells.map(({ id, mode }) => ({ id, mode }))).toEqual([
      { id: "0-0", mode: "rain" },
      { id: "0-1", mode: "cloudy" },
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toContain("latitude=34.7%2C35");
    expect(fetch.mock.calls[0]?.[0]).toContain("current=precipitation%2Cweather_code%2Ccloud_cover");
  });
});
