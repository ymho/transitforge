import { describe, expect, it, vi } from "vitest";

import type { PrivateObject, PrivateObjectStorage } from "../ports/private-object-storage.js";
import { createAgentTraceOperation, storeAgentTrace } from "./agent-trace.js";

describe("agent trace parity", () => {
  it("stores validated trace under the existing S3 prefix", async () => {
    const storage = new RecordingStorage();
    const result = await storeAgentTrace(submission(), { bucket: "private-bucket", storage }, fixedNow, "trace-1");
    expect(result).toEqual({ traceId: "trace-1", eventCount: 1 });
    expect(storage.values[0]?.key).toBe("agent-traces/2026/08/25/task-1/trace-1.json");
    expect(storage.values[0]?.encryption).toBe("AES256");
    const payload = storedJson(storage);
    expect(payload).toMatchObject({
      schemaVersion: "agent-trace-submission-v1",
      taskId: "task-1",
      executionId: "execution-1",
      requestIds: ["model-request-1"],
    });
  });

  it("rejects unknown events ordering and oversized trace", async () => {
    const unknown = submission();
    unknown.trace.events = [{ type: "run_javascript", sequence: 1, occurredAt: "2026-08-25T09:00:00Z" }];
    await expect(store(unknown)).rejects.toMatchObject({ statusCode: 400 });
    const reversed = submission();
    reversed.trace.events = [traceEvent(2, "first"), traceEvent(1, "second")];
    await expect(store(reversed)).rejects.toMatchObject({ statusCode: 400 });
    const huge = submission();
    huge.trace.events = Array.from({ length: 70 }, (_, index) => traceEvent(index + 1, "x".repeat(500)));
    await expect(store(huge)).rejects.toMatchObject({ statusCode: 413 });
  });

  it("redacts secrets and current coordinates before storage", async () => {
    const value = submission();
    value.trace.events = [{
      type: "intent_normalized",
      sequence: 1,
      occurredAt: "2026-08-25T09:00:00Z",
      intent: "token=do-not-store Bearer private-token 現在地35.0123,135.1234 緯度=35.1 経度=135.1",
      constraints: { byteLength: 100, truncated: false, value: { apiKey: "private-key", currentLocation: { latitude: 35, longitude: 135 }, station: "京都" } },
    }];
    const storage = new RecordingStorage();
    await storeAgentTrace(value, { bucket: "private-bucket", storage }, fixedNow, "trace-1");
    const stored = new TextDecoder().decode(storage.values[0]?.body);
    for (const privateValue of ["do-not-store", "private-token", "private-key", "35.0123", "135.1234", "緯度=35.1", "経度=135.1"]) {
      expect(stored).not.toContain(privateValue);
    }
    expect(stored).toContain("[redacted]");
    expect(stored).toContain("[location-redacted]");
    expect(stored).toContain("京都");
  });

  it("stores externalizable decision outcomes without internal reasoning", async () => {
    const value = submission();
    value.trace.events = [{
      type: "decision_recorded",
      sequence: 1,
      occurredAt: "2026-08-25T09:00:00Z",
      interpretedGoal: "16:30までに大阪へ戻れる日帰り先を決める",
      hardConstraints: {
        byteLength: 80,
        truncated: false,
        value: [{ key: "return_deadline", value: "16:30", source: "user" }],
      },
      softPreferences: {
        byteLength: 70,
        truncated: false,
        value: [{ key: "interest", value: "自然", source: "travel_profile" }],
      },
      selectedAction: "use_tool",
      selectedTool: "search_journeys",
      unresolvedFacts: ["到達可能な候補"],
      reasonCodes: ["evidence_required"],
      replanReason: "tool_result_received",
    }];
    const storage = new RecordingStorage();

    await storeAgentTrace(value, { bucket: "private-bucket", storage }, fixedNow, "trace-1");

    const stored = new TextDecoder().decode(storage.values[0]?.body);
    expect(stored).toContain("decision_recorded");
    expect(stored).toContain("search_journeys");
    expect(stored).not.toContain("Chain-of-Thought");
  });

  it("validates model call linkage events", async () => {
    const value = submission();
    value.trace.events = [{
      type: "model_started",
      sequence: 1,
      occurredAt: "2026-09-02T08:19:42Z",
      modelCallId: "model-call-1",
      modelClass: "decision",
      messageCount: 7,
      toolNames: ["search_web", "read_web_pages"],
    }, {
      type: "model_failed",
      sequence: 2,
      occurredAt: "2026-09-02T08:19:45Z",
      modelCallId: "model-call-1",
      reason: "provider_error",
    }];
    const storage = new RecordingStorage();

    await storeAgentTrace(value, { bucket: "private-bucket", storage }, fixedNow, "trace-1");

    expect(storedJson(storage)).toMatchObject({
      trace: { events: [{
        type: "model_started",
        modelCallId: "model-call-1",
        messageCount: 7,
      }, {
        type: "model_failed",
        modelCallId: "model-call-1",
      }] },
    });
  });

  it("returns bounded storage failures and logs identifiers only", async () => {
    const log = vi.fn();
    const operation = createAgentTraceOperation({
      bucket: "private-bucket",
      storage: { put: async () => { throw new Error("private storage failure"); } },
      now: () => fixedNow,
      createId: () => "trace-1",
      log,
    });
    const result = await operation(submission(), { requestId: "request-1" });
    expect(result).toEqual({ statusCode: 503, body: { message: "Agent Traceを保存できませんでした。" } });
    expect(JSON.stringify(log.mock.calls)).not.toContain("private storage failure");
    expect(JSON.stringify(log.mock.calls)).not.toContain("京都から出雲市へ行きたい");
  });
});

const fixedNow = new Date("2026-08-25T09:00:00Z");

function submission(): {
  taskId: string;
  requestIds: string[];
  trace: {
    executionId: string;
    droppedEventCount: number;
    events: Record<string, unknown>[];
  };
} {
  return {
    taskId: "task-1",
    requestIds: ["model-request-1"],
    trace: { executionId: "execution-1", droppedEventCount: 0, events: [traceEvent(1, "京都から出雲市へ行きたい")] },
  };
}

function traceEvent(sequence: number, response: string) {
  return { type: "response_generated", sequence, occurredAt: "2026-08-25T09:00:00Z", response, claimIds: [] };
}

function store(value: ReturnType<typeof submission>) {
  return storeAgentTrace(value, { bucket: "private-bucket", storage: new RecordingStorage() }, fixedNow, "trace-1");
}

class RecordingStorage implements PrivateObjectStorage {
  readonly values: PrivateObject[] = [];
  async put(value: PrivateObject) { this.values.push(value); }
}

function storedJson(storage: RecordingStorage): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(storage.values[0]?.body));
}
