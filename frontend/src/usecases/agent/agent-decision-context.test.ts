import { describe, expect, it } from "vitest";

import {
  agentDecisionContextText,
  buildAgentDecisionContext,
} from "./agent-decision-context";

describe("AgentDecisionContext", () => {
  it("gives Bedrock bounded structured context without exact location or secrets", () => {
    const context = buildAgentDecisionContext({
      executionId: "execution-1",
      feature: "travel_planning",
      userRequest: "明日どこか行きたい。16:30には大阪に戻りたい",
      context: {
        featureContext: {
          displayTimeMinutes: 600,
          calendarDate: "2026-08-30",
          serviceDate: "2026-08-30",
        },
        conversation: {
          summary: "日帰りの相談",
          relevantMessages: ["自然を感じたい"],
          pendingTopics: ["行き先"],
        },
        tripContext: { startDate: "2026-08-31", returnArrivalTimeMinutes: 990 },
        travelProfile: {
          favoriteInterests: ["自然", "温泉"],
          latitude: 35.0123,
          apiKey: "secret-value",
        },
        currentJourney: {
          contextKind: "previous_verified_journey",
          originStation: "向日町",
          destinationStation: "出雲市",
          journeys: [{ legs: [{
            trainName: "やくも5号",
            originStation: "岡山",
            destinationStation: "出雲市",
          }] }],
        },
        knownHardConstraints: [{
          key: "return_arrival_deadline_minutes",
          value: 990,
          source: "trip_context",
        }],
        knownSoftPreferences: [{
          key: "favorite_interest",
          value: "自然",
          source: "travel_profile",
        }],
      },
    }, [{
      name: "search_journeys",
      description: "能力: 日付別時刻表で経路を検索する",
      inputSchema: {
        type: "object",
        properties: {},
        required: ["originStation", "destinationStation"],
      },
    }]);

    expect(context.userRequest).toContain("16:30");
    expect(context.knownHardConstraints).toHaveLength(1);
    expect(context.knownSoftPreferences).toHaveLength(1);
    expect(context.currentJourney).toEqual(expect.objectContaining({
      contextKind: "previous_verified_journey",
      destinationStation: "出雲市",
    }));
    expect(JSON.stringify(context.currentJourney)).toContain("やくも5号");
    expect(context.availableTools[0]).toEqual(expect.objectContaining({
      name: "search_journeys",
      requiredInputs: ["originStation", "destinationStation"],
    }));
    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain("35.0123");
    expect(serialized).not.toContain("secret-value");
    const prompt = agentDecisionContextText(context);
    expect(prompt).toContain("<agent_context>");
    expect(prompt).toContain('"contextKind":"previous_verified_journey"');
    expect(prompt).toContain("やくも5号");
    expect(prompt.length).toBeLessThanOrEqual(4_000);
  });
});
