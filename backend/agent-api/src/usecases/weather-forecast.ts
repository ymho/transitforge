import type { WeatherForecastProvider } from "../ports/weather-provider.js";
import type { AgentOperation } from "../ports/agent-operation.js";

export function createWeatherForecastOperation(provider: WeatherForecastProvider): AgentOperation {
  return async (request) => {
    const location = typeof request.location === "string" ? request.location.trim() : "";
    const startDate = date(request.startDate);
    const endDate = date(request.endDate);
    if (!location || location.length > 100 || request.startDate !== undefined && !startDate || request.endDate !== undefined && !endDate ||
      startDate && endDate && startDate > endDate) {
      return { statusCode: 400, body: { message: "天気予報の検索条件が不正です" } };
    }
    const result = await provider.search({ location, ...(startDate ? { startDate } : {}), ...(endDate ? { endDate } : {}) });
    return { body: { forecast: result } };
  };
}

function date(value: unknown): string | undefined {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value) ? value : undefined;
}
