import { describe, expect, it } from "vitest";
import { DefaultAgentPlanner } from "./agent-planner";

describe("DefaultAgentPlanner", () => {
  it("keeps a trace summary without encoding a fixed travel workflow", () => {
    const plan = new DefaultAgentPlanner().createPlan({
      feature: "travel_planning",
      normalizedIntent: "bedrock_decision_required",
      objective: "香港へ一泊",
      constraints: {},
      missingInformation: [],
      decisionContext: {
        userRequest: "香港へ一泊",
        featureContext: { feature: "travel_planning" },
        verifiedFacts: [],
        knownHardConstraints: [],
        knownSoftPreferences: [],
        previousToolOutcomes: [],
        availableTools: [],
      },
    }, [
      { name: "search_direct_routes", description: "", inputSchema: { type: "object", properties: {} } },
      { name: "search_weather_forecast", description: "", inputSchema: { type: "object", properties: {} } },
      { name: "search_place_media", description: "", inputSchema: { type: "object", properties: {} } },
    ]);
    expect(plan.steps).toEqual([
      expect.stringContaining("Bedrockが判断"),
      expect.stringContaining("能力contract"),
      expect.stringContaining("Evidence Policy"),
    ]);
    expect(plan.steps.join(" ")).not.toContain("宿泊候補");
    expect(plan.steps.join(" ")).not.toContain("天気");
  });
});
