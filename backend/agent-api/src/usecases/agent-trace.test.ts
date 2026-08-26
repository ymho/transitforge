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
