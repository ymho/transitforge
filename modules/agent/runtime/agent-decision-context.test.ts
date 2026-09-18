import { describe, expect, it } from "vitest";

import {
  agentDecisionContextText,
  buildAgentDecisionContext,
} from "@raiquora/agent/agent-decision-context";

describe("AgentDecisionContext", () => {
  it("bounds conversation metadata and preserves topics when compressing restored history", () => {
    const context = buildAgentDecisionContext({ executionId: "restored", feature: "concierge", userRequest: "相談".repeat(750), context: {
      conversation: { title: "題".repeat(200), scope: "trip", summary: "要約".repeat(2000),
        messages: Array.from({ length: 30 }, (_, i) => ({ role: "user", text: `${i}:` + "履歴".repeat(1000) })),
        resolvedTopics: Array.from({ length: 20 }, () => "済".repeat(200)), pendingTopics: Array.from({ length: 20 }, () => "未".repeat(200)),
      },
    } }, []);
    expect(context.conversation?.title?.length).toBe(160);
    expect(context.conversation?.summary?.length).toBe(800);
    expect(context.conversation?.messages).toHaveLength(12);
    const json = agentDecisionContextText(context).match(/<agent_context>([\s\S]*)<\/agent_context>/)![1];
    const parsed = JSON.parse(json);
    expect(parsed.contextTruncated).toBe(true);
    expect(parsed.conversation.scope).toBe("trip");
    expect(parsed.conversation.resolvedTopics).toHaveLength(12);
    expect(parsed.conversation.pendingTopics).toHaveLength(12);
    expect(json.length).toBeLessThanOrEqual(24_000);
  });
  it("preserves turn, past-time assessment and unknown hard conditions when compacting", () => {
    const context = buildAgentDecisionContext({ executionId: "compact-progress", feature: "concierge", userRequest: "以前の旅",
      context: { previousAssistantTurn: "ask_only", currentTrip: { planningState: "candidate_selection", lifecycleState: "pre_trip",
        request: { constraints: [], assumptions: [] }, temporalAssessment: { position: "past", date: "2025-09-22" },
        hardConstraintEvaluation: [{ constraintId: "deadline", status: "unknown" }],
        schedule: Array.from({ length: 80 }, () => ({ description: "詳細".repeat(200) })),
      }, currentJourney: { legs: Array.from({ length: 20 }, () => ({ description: "詳細".repeat(200) })) } },
    }, []);
    const parsed = JSON.parse(agentDecisionContextText(context).match(/<agent_context>([\s\S]*)<\/agent_context>/u)![1]!);
    expect(parsed.previousAssistantTurn).toBe("ask_only");
    expect(parsed.currentTrip.temporalAssessment).toMatchObject({ position: "past", date: "2025-09-22" });
    expect(parsed.currentTrip.hardConstraintEvaluation).toEqual([{ constraintId: "deadline", status: "unknown" }]);
    expect(parsed.persistedTripRequest).toEqual({ constraints: [], assumptions: [] });
  });
  it("keeps adopted plan, candidates and observations separate and bounded", () => {
    const context = buildAgentDecisionContext({ executionId: "trip-layers", feature: "concierge", userRequest: "比較したい",
      context: { currentTrip: { title: "採用済み", schedule: [{ selectionStatus: "selected", scheduledDeparture: "09:00" }] },
        travelCandidates: Array.from({ length: 20 }, (_, index) => ({ candidateRef: `c${index}`, scheduledDeparture: "10:00", apiKey: "private" })),
        realtimeFacts: [{ candidateRef: "c0", estimatedDeparture: "10:10", freshness: "unknown" }] },
    }, []);
    expect(context.travelCandidates).toHaveLength(12);
    const encoded = agentDecisionContextText(context);
    const parsed = JSON.parse(encoded.match(/<agent_context>([\s\S]*)<\/agent_context>/u)![1]!);
    expect(parsed.currentTrip.schedule[0].scheduledDeparture).toBe("09:00");
    expect(parsed.travelCandidates[0].scheduledDeparture).toBe("10:00");
    expect(parsed.realtimeFacts[0].estimatedDeparture).toBe("10:10");
    expect(encoded).not.toContain("private");
  });
  it("keeps travel context but does not forward retired persona fields", () => {
    const legacyInput = {
      personaInstruction: "廃止されたキャラクターとして話す",
      travelProfile: { home: { station: "京都駅" }, favoriteInterests: ["歴史"] },
      tripContext: { startDate: "2026-09-20", stayNights: 1 },
      conversation: { messages: [{ role: "user" as const, text: "1泊で行きたい" }] },
    };
    const context = buildAgentDecisionContext({ executionId: "no-persona", feature: "concierge",
      userRequest: "お願いします", context: legacyInput,
    }, []);
    const prompt = agentDecisionContextText(context);
    expect(prompt).toContain("京都駅");
    expect(prompt).toContain("歴史");
    expect(prompt).toContain("2026-09-20");
    expect(prompt).toContain("1泊で行きたい");
    expect(prompt).not.toContain("personaInstruction");
    expect(prompt).not.toContain("廃止されたキャラクター");
  });
  it.each([
    ["2026-08-30", "2026-08-31", "2026-09-01"],
    ["2028-02-28", "2028-02-29", "2028-03-01"],
    ["2026-12-31", "2027-01-01", "2027-01-02"],
  ])("derives calendar references without selecting a travel date: %s", (today, tomorrow, dayAfterTomorrow) => {
    const context = buildAgentDecisionContext({ executionId: "date-reference", feature: "concierge", userRequest: "旅行したい",
      context: { featureContext: { calendarDate: today }, tripContext: { planningStage: "inspiration" } },
    }, []);
    expect(context.featureContext.relativeDates).toEqual({ today, tomorrow, dayAfterTomorrow });
    expect(context.tripContext?.startDate).toBeUndefined();
    expect(context.knownHardConstraints).toEqual([]);
    expect(agentDecisionContextText(context)).toContain(`"tomorrow":"${tomorrow}"`);
  });

  it.each([undefined, "2026-02-30", "9999-12-31"])("does not fabricate references for an invalid or overflowing date: %s", (calendarDate) => {
    const context = buildAgentDecisionContext({ executionId: "date-reference", feature: "concierge", userRequest: "旅行したい",
      context: { featureContext: { calendarDate } },
    }, []);
    expect(context.featureContext.relativeDates).toBeUndefined();
  });

  it("retains the full capability contract without duplicating descriptions in prompt context", () => {
    const description = "能力の説明".repeat(500) + "境界: 未確認情報を断定しない";
    const context = buildAgentDecisionContext({
      executionId: "long-tool-description", feature: "concierge", userRequest: "旅を相談したい",
    }, [{ name: "search_web", description, inputSchema: { type: "object", properties: {}, required: ["query"] } }]);
    expect(context.availableTools[0]?.description).toBe(description);
    const prompt = agentDecisionContextText(context);
    expect(prompt).toContain("search_web");
    expect(prompt).not.toContain("能力の説明");
  });

  it("retains the question and answer after a long recommendation instead of slicing conversation JSON", () => {
    const previous = [
      { role: "user", text: "静かな場所で休みたい" },
      { role: "assistant", text: "候補の見どころと比較です。".repeat(70) },
      { role: "user", text: "近いところがよい" },
      { role: "assistant", text: "日程はいつですか?" },
      { role: "user", text: "来週金曜日から1泊" },
    ];
    const context = buildAgentDecisionContext({
      executionId: "conversation-test", feature: "concierge", userRequest: "お願いします",
      context: { conversation: { relevantMessages: [JSON.stringify(previous)] } },
    }, []);
    const serialized = agentDecisionContextText(context);
    const parsed = JSON.parse(serialized.match(/<agent_context>([\s\S]*)<\/agent_context>/u)![1]!);
    expect(parsed.conversation.messages).toEqual(previous);
    expect(parsed.conversation.relevantMessages).toEqual([]);
  });

  it("preserves recent conversation even when a large journey must be compacted", () => {
    const context = buildAgentDecisionContext({
      executionId: "large-conversation", feature: "concierge", userRequest: "その条件でお願いします",
      context: {
        conversation: { messages: [
          { role: "assistant", text: "帰宅時刻は何時を希望しますか？" },
          { role: "user", text: "21時には自宅へ着きたい" },
        ] },
        currentJourney: { journeys: Array.from({ length: 20 }, () => ({
          legs: Array.from({ length: 20 }, () => ({ description: "経路の詳細".repeat(60) })),
        })) },
      },
    }, []);
    const prompt = agentDecisionContextText(context);
    const serialized = prompt.match(/<agent_context>([\s\S]*)<\/agent_context>/u)![1]!;
    expect(serialized.length).toBeLessThanOrEqual(24_000);
    expect(JSON.parse(serialized).conversation.messages.at(-1).text).toBe("21時には自宅へ着きたい");
    expect(prompt).not.toContain("personaInstruction");
  });

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
