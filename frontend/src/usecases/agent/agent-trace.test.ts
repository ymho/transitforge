import { describe, expect, it } from "vitest";

import type { Evidence } from "./evidence-model";
import { AgentTraceRecorder, summarizeTracePayload } from "./agent-trace";

const fixedNow = () => new Date("2026-08-25T09:00:00.000Z");

describe("AgentTraceRecorder", () => {
  it("records the agent task in an ordered and reconstructable event stream", () => {
    const recorder = new AgentTraceRecorder("execution-1", { now: fixedNow });
    recorder.taskStarted("京都から出雲市へ行きたい");
    recorder.intentNormalized("journey_search", { origin: "京都", destination: "出雲市" });
    recorder.planCreated(["経路を検索する", "候補を比較する"]);
    recorder.decisionRecorded({
      interpretedGoal: "出雲市へ移動する",
      hardConstraints: [{ key: "arrival", value: "16:30", source: "user" }],
      softPreferences: [{ key: "pace", value: "relaxed", source: "travel_profile" }],
      selectedAction: "use_tool",
      selectedTool: "search_journeys",
      unresolvedFacts: ["経路"],
      reasonCodes: ["evidence_required"],
    });
    recorder.toolCalled("call-1", "search_journeys", { origin: "京都" });
    recorder.toolCompleted("call-1", "search_journeys", {
      ok: true,
      output: { journeyIds: ["journey-1"] },
    }, 12);
    recorder.evidenceCollected([fixtureEvidence]);
    recorder.replanDecided(false, "必要な経路が得られた");
    recorder.modelCompleted({
      provider: "bedrock",
      requestId: "request-1",
      model: "model-a",
      latencyMs: 80,
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });
    recorder.responseGenerated("この経路を利用できます", ["claim-1"]);
    recorder.viewerAction("highlight_route", "proposed", {
      targetEntityId: "journey-1",
    });
    recorder.viewerAction("highlight_route", "applied", {
      targetEntityId: "journey-1",
    });
    recorder.taskCompleted("completed", 100);

    const trace = recorder.snapshot();
    expect(trace.executionId).toBe("execution-1");
    expect(trace.events.map(({ type }) => type)).toEqual([
      "task_started",
      "intent_normalized",
      "plan_created",
      "decision_recorded",
      "tool_called",
      "tool_completed",
      "evidence_collected",
      "replan_decided",
      "model_completed",
      "response_generated",
      "viewer_action",
      "viewer_action",
      "task_completed",
    ]);
    expect(trace.events.map(({ sequence }) => sequence)).toEqual(
      Array.from({ length: 13 }, (_, index) => index + 1),
    );
    expect(trace.events.every(({ occurredAt }) =>
      occurredAt === "2026-08-25T09:00:00.000Z")).toBe(true);
    expect(trace.events[5]).toMatchObject({ latencyMs: 12, outcome: "success" });
    expect(trace.events[8]).toMatchObject({
      provider: "bedrock",
      requestId: "request-1",
      totalTokens: 15,
    });
    expect(JSON.stringify(trace)).not.toContain("Chain-of-Thought");
  });

  it("redacts secrets and exact location coordinates before storing payloads", () => {
    const recorder = new AgentTraceRecorder("execution-2", { now: fixedNow });
    recorder.taskStarted("Authorization: Bearer abc.def token=secret-value");
    recorder.toolCalled("call-1", "nearest_station", {
      apiKey: "do-not-store",
      nested: {
        latitude: 35.0123,
        longitude: 135.1234,
        station: "京都",
      },
    });

    const serialized = JSON.stringify(recorder.snapshot());
    expect(serialized).not.toContain("abc.def");
    expect(serialized).not.toContain("secret-value");
    expect(serialized).not.toContain("do-not-store");
    expect(serialized).not.toContain("35.0123");
    expect(serialized).not.toContain("135.1234");
    expect(serialized).toContain("[redacted]");
    expect(serialized).toContain("[location-redacted]");
    expect(serialized).toContain("京都");
  });

  it("summarizes a large payload and bounds the number of events", () => {
    const recorder = new AgentTraceRecorder("execution-3", {
      now: fixedNow,
      maxEvents: 2,
      maxPayloadCharacters: 40,
    });
    recorder.taskStarted("検索したい");
    recorder.toolCalled("call-1", "search_journeys", {
      results: Array.from({ length: 100 }, (_, index) => ({ id: index })),
    });
    recorder.taskCompleted("completed");

    const trace = recorder.snapshot();
    expect(trace.events).toHaveLength(2);
    expect(trace.droppedEventCount).toBe(1);
    expect(trace.events[1]).toMatchObject({
      type: "tool_called",
      input: { truncated: true },
    });
    expect(JSON.stringify(trace.events[1])).not.toContain('"id":99');
  });

  it("records tool errors and viewer action rejection reasons without exception details", () => {
    const recorder = new AgentTraceRecorder("execution-4", { now: fixedNow });
    recorder.toolCompleted("call-1", "search_journeys", {
      ok: false,
      error: {
        code: "not_found",
        message: "検証済みの経路がありません",
        retryable: false,
      },
    });
    recorder.viewerAction("focus_train", "rejected", {
      targetEntityId: "unknown-train",
      reason: "同じ実行で検証された列車ではありません",
    });

    expect(recorder.snapshot().events).toEqual([
      expect.objectContaining({
        type: "tool_completed",
        outcome: "error",
        errorCode: "not_found",
        retryable: false,
      }),
      expect.objectContaining({
        type: "viewer_action",
        status: "rejected",
        reason: "同じ実行で検証された列車ではありません",
      }),
    ]);
  });
});

describe("summarizeTracePayload", () => {
  it("handles unserializable and deeply nested values safely", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const summary = summarizeTracePayload(circular, { maxDepth: 2 });

    expect(summary.byteLength).toBeGreaterThan(0);
    expect(JSON.stringify(summary.value)).toContain("[depth-limited]");
  });
});

const fixtureEvidence: Evidence = {
  id: "evidence-1",
  category: "journey",
  knowledgeKind: "deterministic_fact",
  subject: "journey-1",
  facts: { departureTime: "09:00" },
  references: [{
    sourceType: "timetable-graph",
    sourceRef: "graph/2026-08-25",
    retrievedAt: null,
    freshness: "scheduled",
    summary: "日付別接続グラフ",
  }],
};
