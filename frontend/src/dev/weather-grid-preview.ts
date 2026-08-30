import type { WeatherGridSearchResponse } from "../adapters/http/agent-api/bedrock-agent";

export async function searchWeatherGridPreview(request: {
  points: Array<{ id: string; latitude: number; longitude: number }>;
  targetTime?: string;
}): Promise<WeatherGridSearchResponse> {
  const observedAt = request.targetTime ?? new Date().toISOString();
  return {
    weatherGrid: {
      status: "available",
      freshness: "fresh",
      evidence: [],
      data: {
        cells: request.points.map((point) => {
          const mode = previewMode(point.longitude);
          return {
            ...point,
            observedAt,
            mode,
            precipitationMillimeters: mode === "rain" ? 2.4 : 0,
            cloudCoverPercent: mode === "clear" ? 15 : mode === "cloudy" ? 72 : 92,
            weatherCode: mode === "rain" ? 61 : mode === "cloudy" ? 2 : 0,
          };
        }),
      },
    },
  };
}

function previewMode(longitude: number): "clear" | "cloudy" | "rain" {
  const rawBand = Math.floor((longitude - 135.48) / 0.01);
  const band = ((rawBand % 3) + 3) % 3;
  return (["clear", "cloudy", "rain"] as const)[band]!;
}
