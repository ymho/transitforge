import { describe, expect, it, vi } from "vitest";

import type { PrivateObject, PrivateObjectStorage } from "../ports/private-object-storage.js";
import { StoredModelCallTraceRecorder } from "./model-call-trace.js";

describe("StoredModelCallTraceRecorder", () => {
  it("stores the exact bounded Bedrock request under the 30-day trace prefix", async () => {
    const storage = new MemoryStorage();
    const log = vi.fn();
    const recorder = new StoredModelCallTraceRecorder({ bucket: "private", storage, log });

    await recorder.record({
      modelCallId: "execution-1-model-2",
      apiRequestId: "request-1",
      startedAt: "2026-09-02T08:19:42.000Z",
      completedAt: "2026-09-02T08:19:45.000Z",
      providerRequest: {
        modelId: "model-1",
        system: [{ text: "system prompt" }],
        messages: [{ role: "user", content: [{ text: "海へ行きたい" }] }],
        inferenceConfig: { maxTokens: 500, temperature: 0 },
      },
      outcome: {
        status: "failed",
        error: { name: "ValidationException", message: "messages are invalid", statusCode: 400 },
      },
    });

    expect(storage.values[0]?.key).toBe(
      "agent-traces/model-calls/2026/09/02/execution-1-model-2/request-1.json",
    );
    const stored = JSON.parse(new TextDecoder().decode(storage.values[0]?.body));
    expect(stored).toMatchObject({
      schemaVersion: "agent-model-call-trace-v1",
      providerRequest: {
        system: [{ text: "system prompt" }],
        messages: [{ role: "user", content: [{ text: "海へ行きたい" }] }],
        inferenceConfig: { maxTokens: 500 },
      },
      outcome: { status: "failed", error: { name: "ValidationException" } },
    });
    expect(log).toHaveBeenCalledWith("agent_model_call_trace_stored", expect.objectContaining({
      outcome: "failed",
      truncated: false,
    }));
  });

  it("redacts secrets and exact coordinates without redacting token limits", async () => {
    const storage = new MemoryStorage();
    const recorder = new StoredModelCallTraceRecorder({ bucket: "private", storage });

    await recorder.record({
      modelCallId: "execution-1-model-1",
      apiRequestId: "request-2",
      startedAt: "2026-09-02T08:00:00.000Z",
      completedAt: "2026-09-02T08:00:01.000Z",
      providerRequest: {
        authorization: "Bearer abc.def",
        currentLocation: { latitude: 35.0123, longitude: 135.1234 },
        inferenceConfig: { maxTokens: 500 },
        messages: [{ role: "user", content: [{ text: "latitude=35.0123" }] }],
      },
      outcome: { status: "completed", stopReason: "end_turn", modelId: "model-1", latencyMs: 1 },
    });

    const serialized = new TextDecoder().decode(storage.values[0]?.body);
    expect(serialized).not.toContain("abc.def");
    expect(serialized).not.toContain("35.0123");
    expect(serialized).toContain("[redacted]");
    expect(serialized).toContain("[location-redacted]");
    expect(serialized).toContain('"maxTokens":500');
  });

  it("replaces an oversized request with bounded metadata", async () => {
    const storage = new MemoryStorage();
    const recorder = new StoredModelCallTraceRecorder({ bucket: "private", storage });

    await recorder.record({
      modelCallId: "model-call-large",
      apiRequestId: "request-large",
      startedAt: "2026-09-02T08:00:00.000Z",
      completedAt: "2026-09-02T08:00:01.000Z",
      providerRequest: {
        modelId: "model-1",
        messages: [{ role: "user", content: [{ text: "x".repeat(3 * 1_024 * 1_024) }] }],
      },
      outcome: { status: "completed", stopReason: "end_turn", modelId: "model-1", latencyMs: 1 },
    });

    const stored = JSON.parse(new TextDecoder().decode(storage.values[0]?.body));
    expect(stored.providerRequest).toMatchObject({
      truncated: true,
      byteLength: expect.any(Number),
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(storage.values[0]?.body.byteLength).toBeLessThan(4_096);
  });
});

class MemoryStorage implements PrivateObjectStorage {
  readonly values: PrivateObject[] = [];
  async put(value: PrivateObject): Promise<void> {
    this.values.push(value);
  }
}
