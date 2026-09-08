import { describe, expect, it, vi } from "vitest";
import { OpenMeteoWeatherProvider } from "./open-meteo-weather-provider.js";

describe("OpenMeteoWeatherProvider", () => {
  it.each([
    [{}, { forecast_days: "7" }],
    [{ startDate: "2026-09-09", endDate: "2026-09-10" }, { start_date: "2026-09-09", end_date: "2026-09-10" }],
    [{ startDate: "2026-09-09" }, { start_date: "2026-09-09", end_date: "2026-09-09" }],
    [{ endDate: "2026-09-10" }, { start_date: "2026-09-09", end_date: "2026-09-10" }],
    [{ endDate: "2026-09-24" }, { start_date: "2026-09-09", end_date: "2026-09-24" }],
  ])("uses mutually exclusive forecast periods for %j", async (dates, expected) => {
    const urls: URL[] = [];
    const fetch = vi.fn(async (input: string) => {
      const url = new URL(input);
      urls.push(url);
      if (url.hostname.startsWith("geocoding")) return new Response(JSON.stringify({ results: [
        { id: 1, name: "京都市", latitude: 35, longitude: 135.8, timezone: "Asia/Tokyo" },
      ] }));
      // Model the real Provider's mutually-exclusive-parameter rejection.
      if (url.searchParams.has("forecast_days") && url.searchParams.has("start_date")) {
        return new Response("{}", { status: 400 });
      }
      return new Response(JSON.stringify({
        hourly: { time: ["2026-09-09T10:00"], temperature_2m: [26], precipitation_probability: [10], precipitation: [0], weather_code: [1] },
        daily: { time: ["2026-09-09"], temperature_2m_min: [23], temperature_2m_max: [27], precipitation_probability_max: [10], precipitation_sum: [0], weather_code: [1] },
      }));
    });
    const provider = new OpenMeteoWeatherProvider({ fetch }, () => new Date("2026-09-08T15:10:00Z"));
    const result = await provider.search({ location: "京都市中京区", ...dates });
    expect(result.status).toBe("available");
    expect(urls[0]?.searchParams.get("name")).toBe("京都市");
    // Canonical city and city+ward share the same forecast cache, without retrying.
    expect(await provider.search({ location: "京都市", ...dates })).toBe(result);
    expect(fetch).toHaveBeenCalledTimes(2);
    const params = urls[1]!.searchParams;
    for (const [key, value] of Object.entries(expected)) expect(params.get(key)).toBe(value);
    expect(params.has("forecast_days")).toBe(!params.has("start_date"));
    expect(result.evidence[0]?.sourceUrl).toBe(urls[1]?.toString());
  });

  it.each(["2026-02-30", "2026-00-01", "not-a-date"])("rejects invalid calendar date %s without HTTP", async (startDate) => {
    const fetch = vi.fn();
    const result = await new OpenMeteoWeatherProvider({ fetch }).search({ location: "京都市", startDate });
    expect(result.failure?.code).toBe("invalid_request");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["2026-09-08", "2026-09-25"])("rejects dates outside the destination's forecast range: %s", async (startDate) => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ results: [
      { id: 1, name: "京都市", latitude: 35, longitude: 135.8, timezone: "Asia/Tokyo" },
    ] })));
    const result = await new OpenMeteoWeatherProvider({ fetch }, () => new Date("2026-09-08T15:10:00Z"))
      .search({ location: "京都市", startDate });
    expect(result.failure).toMatchObject({ code: "invalid_request", retryable: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("explains the supported city input when a facility cannot be geocoded", async () => {
    const fetch = vi.fn(async () => new Response('{"results":[]}'));
    const result = await new OpenMeteoWeatherProvider({ fetch }).search({ location: "観光施設" });
    expect(result.failure?.message).toContain("市区町村名");
    expect(result.evidence).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects a reversed range without HTTP", async () => {
    const fetch = vi.fn();
    const result = await new OpenMeteoWeatherProvider({ fetch })
      .search({ location: "京都市", startDate: "2026-09-10", endDate: "2026-09-09" });
    expect(result.failure?.code).toBe("invalid_request");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([[400, "invalid_request", false], [429, "rate_limited", true], [503, "unavailable", true]] as const)
    ("preserves Provider HTTP failure semantics for %i", async (status, code, retryable) => {
      const fetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ id: 1, name: "京都市", latitude: 35, longitude: 135.8, timezone: "Asia/Tokyo" }] })))
        .mockResolvedValueOnce(new Response("{}", { status }));
      const result = await new OpenMeteoWeatherProvider({ fetch }).search({ location: "京都市" });
      expect(result.failure).toMatchObject({ code, retryable });
      expect(result.evidence).toEqual([]);
    });

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
