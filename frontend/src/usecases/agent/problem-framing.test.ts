import { describe, expect, it } from "vitest";

import { DefaultAgentProblemFramer } from "./problem-framing";

describe("DefaultAgentProblemFramer", () => {
  it("builds decision context instead of classifying natural-language intent", () => {
    const frame = new DefaultAgentProblemFramer().frame({
      executionId: "execution-1",
      feature: "travel_planning",
      userRequest: "明日どこか行きたい。16:30には大阪に戻りたい",
      context: {
        knownHardConstraints: [{
          key: "return_arrival_deadline_minutes",
          value: 990,
          source: "trip_context",
        }],
      },
    }, [{
      name: "search_journeys",
      description: "能力: 経路を検索する",
      inputSchema: { type: "object", properties: {} },
    }]);

    expect(frame.normalizedIntent).toBe("bedrock_decision_required");
    expect(frame.constraints).toEqual({ return_arrival_deadline_minutes: 990 });
    expect(frame.decisionContext.availableTools).toHaveLength(1);
    expect(frame.objective).toContain("<agent_context>");
    expect(frame.objective).not.toContain("plan_travel");
  });
});
