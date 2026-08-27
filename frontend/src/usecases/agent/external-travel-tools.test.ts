import { describe, expect, it, vi } from "vitest";
import {
  executeExternalTravelTool,
  externalTravelEvidence,
  externalTravelToolInputSchema,
  hasExternalTravelInformation,
  type ExternalTravelToolState,
} from "./external-travel-tools";

describe("external travel tools", () => {
  it("天気検索結果を構造化状態とEvidenceへ保持する", async () => {
    const state: ExternalTravelToolState = {};
    const forecast = {
      status: "available",
      freshness: "fresh",
      retrievedAt: "2026-08-27T00:00:00.000Z",
      data: { locationName: "香港", daily: [], hourly: [], alertsAvailable: false },
      evidence: [{
        id: "weather:hong-kong",
        kind: "weather",
        provider: "open-meteo",
        sourceUrl: "https://api.open-meteo.com/v1/forecast",
        retrievedAt: "2026-08-27T00:00:00.000Z",
        attribution: "Open-Meteo",
      }],
    };
    const searchWeatherForecast = vi.fn(async () => ({ forecast }));

    const result = await executeExternalTravelTool(
      "search_weather_forecast",
      { location: "香港", startDate: "2026-08-28" },
      { searchWeatherForecast },
      state,
    );

    expect(result).toEqual({ forecast });
    expect(state.weather).toBe(forecast);
    expect(hasExternalTravelInformation(state)).toBe(true);
    expect(externalTravelEvidence(result, { retrievedAt: "2026-08-27T00:00:00.000Z" })[0]).toMatchObject({
      category: "external",
      subject: "香港の天気予報",
    });
  });

  it("片方だけの座標を観光地検索へ渡さない", async () => {
    await expect(executeExternalTravelTool(
      "search_place_media",
      { query: "出雲大社", latitude: 35.4 },
      { searchPlaceMedia: vi.fn() },
      {},
    )).rejects.toThrow("観光地の検索条件が不正です");
  });

  it("外部ToolのSchemaを閉じた契約として返す", () => {
    expect(externalTravelToolInputSchema("search_flights")).toMatchObject({
      required: ["originAirportCode", "destinationAirportCode", "departureDate"],
      additionalProperties: false,
    });
  });
});
