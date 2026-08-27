import { describe, expect, it } from "vitest";
import { DefaultAgentPlanner } from "./agent-planner";

describe("DefaultAgentPlanner", () => {
  it("builds an evidence-oriented travel research plan from available tools", () => {
    const plan = new DefaultAgentPlanner().createPlan({ feature: "travel_planning", normalizedIntent: "plan_travel", objective: "香港へ一泊", constraints: {}, missingInformation: [] }, [
      { name: "search_direct_routes", description: "", inputSchema: { type: "object", properties: {} } },
      { name: "search_weather_forecast", description: "", inputSchema: { type: "object", properties: {} } },
      { name: "search_place_media", description: "", inputSchema: { type: "object", properties: {} } },
    ]);
    expect(plan.steps).toEqual(expect.arrayContaining([expect.stringContaining("鉄道経路"), expect.stringContaining("天気"), expect.stringContaining("Place"), expect.stringContaining("再計画")]));
  });
});
