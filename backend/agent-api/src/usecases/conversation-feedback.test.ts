import { describe, expect, it, vi } from "vitest";

import type { PrivateObject, PrivateObjectStorage } from "../ports/private-object-storage.js";
import {
  createConversationFeedbackOperation,
  storeConversationFeedback,
} from "./conversation-feedback.js";

describe("conversation feedback parity", () => {
  it("stores the v1 and v2 contracts under the existing S3 prefix", async () => {
    for (const [value, version] of [
      [submissionV1(), "conversation-feedback-v1"],
      [submissionV2(), "conversation-feedback-v2"],
    ] as const) {
      const storage = new RecordingStorage();
      await storeConversationFeedback(value, { bucket: "private-bucket", storage }, fixedNow, "feedback-1");

      expect(storage.values[0]?.key).toBe("conversation-feedback/2026/08/25/feedback-1.json");
      const payload = storedJson(storage);
      expect(payload.schemaVersion).toBe(version);
      expect(payload.createdAt).toBe("2026-08-25T09:00:00+00:00");
      expect(payload.conversation).toEqual(version.endsWith("v1")
        ? [{ role: "user", text: "京都へ行きたい" }, { role: "assistant", text: "経路を案内します" }]
        : submissionV2().conversation);
    }
  });

  it("rejects invalid v2 targets comments links and oversized records", async () => {
    const invalid = [
      { ...submissionV2(), targetMessageId: "message-1" },
      { ...submissionV2(), comment: "\u0000secret" },
      { ...submissionV2(), rating: "good", comment: "不要" },
      { ...submissionV2(), requestIds: [] },
    ];
    for (const value of invalid) {
      await expect(store(value)).rejects.toMatchObject({ statusCode: 400 });
    }
    const huge = submissionV2();
    huge.conversation = Array.from({ length: 50 }, (_, index) => ({
      messageId: `message-${index}`,
      role: index === 49 ? "assistant" : "user",
      text: "界".repeat(4_000),
    }));
    huge.targetMessageId = "message-49";
    huge.requestIds = [];
    await expect(store(huge)).rejects.toMatchObject({ statusCode: 413 });
  });

  it("returns a bounded failure and logs no private conversation", async () => {
    const log = vi.fn();
    const operation = createConversationFeedbackOperation({
      bucket: "private-bucket",
      storage: { put: async () => { throw new Error("private storage failure"); } },
      now: () => fixedNow,
      createId: () => "feedback-1",
      log,
    });
    const result = await operation(submissionV1(), { requestId: "request-1" });
    expect(result).toEqual({ statusCode: 503, body: { message: "会話フィードバックを保存できませんでした。" } });
    expect(JSON.stringify(log.mock.calls)).not.toContain("private storage failure");
    expect(JSON.stringify(log.mock.calls)).not.toContain("京都へ行きたい");
  });
});

const fixedNow = new Date("2026-08-25T09:00:00Z");

function submissionV1() {
  return {
    rating: "bad",
    requestIds: ["request-1"],
    conversation: [
      { role: "user", text: " 京都へ行きたい " },
      { role: "assistant", text: " 経路を案内します " },
    ],
  };
}

function submissionV2() {
  return {
    schemaVersion: "conversation-feedback-v2",
    rating: "bad",
    comment: " 条件が反映されていません ",
    sessionId: "session-1",
    targetMessageId: "message-2",
    requestIds: ["request-1"],
    conversation: [
      { messageId: "message-1", role: "user", text: "京都へ行きたい" },
      { messageId: "message-2", role: "assistant", text: "経路を案内します", requestId: "request-1" },
    ],
  };
}

function store(value: Record<string, unknown>) {
  return storeConversationFeedback(value, { bucket: "private-bucket", storage: new RecordingStorage() }, fixedNow, "feedback-1");
}

class RecordingStorage implements PrivateObjectStorage {
  readonly values: PrivateObject[] = [];
  async put(value: PrivateObject) { this.values.push(value); }
}

function storedJson(storage: RecordingStorage): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(storage.values[0]?.body));
}
