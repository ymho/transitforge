import { describe, expect, it, vi } from "vitest";
import { createWeatherForecastOperation } from "./weather-forecast.js";

describe("weather forecast operation", () => {
  it("rejects invalid dates and delegates valid queries", async () => {
    const search = vi.fn(async () => ({ status: "unknown" as const, freshness: "unknown" as const, evidence: [] }));
    const operation = createWeatherForecastOperation({ search });
    await expect(operation({ location: "香港", startDate: "bad" }, { requestId: "r" })).resolves.toMatchObject({ statusCode: 400 });
    await operation({ location: "香港", startDate: "2026-08-27", endDate: "2026-08-28" }, { requestId: "r" });
    expect(search).toHaveBeenCalledWith({ location: "香港", startDate: "2026-08-27", endDate: "2026-08-28" });
  });
});
