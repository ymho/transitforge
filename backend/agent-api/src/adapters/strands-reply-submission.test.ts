import { describe, expect, it } from "vitest";
import { AgentV2ReplySubmission } from "./strands-reply-submission.js";
describe("Strands reply submission", () => {
  it("accepts one typed proposal and does not let later replies replace it", () => {
    const channel = new AgentV2ReplySubmission();
    expect(channel.receive({ kind: "unavailable", operation: "save" })).toEqual({ ok: true });
    expect(channel.receive({ kind: "operation_result", receiptId: "fake" })).toEqual({ ok: false, code: "already_submitted" });
    expect(channel.snapshot()).toEqual({ kind: "unavailable", operation: "save" });
  });
  it("never retains raw text and allows normal SDK tool correction after invalid input", () => {
    const channel = new AgentV2ReplySubmission();
    expect(channel.receive({ kind: "conversation", message: "acknowledgement", text: "保存しておきます" }))
      .toEqual({ ok: false, code: "invalid_proposal" });
    expect(channel.submitted).toBe(false);
    expect(channel.receive({ kind: "conversation", message: "thanks" }).ok).toBe(true);
    const snapshot = channel.snapshot();
    if (snapshot?.kind === "conversation") snapshot.message = "greeting";
    expect(channel.snapshot()).toEqual({ kind: "conversation", message: "thanks" });
  });
});
