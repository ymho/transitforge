import { describe, expect, it } from "vitest";
import { classifyStrandsV2LiveError, evaluateStrandsV2LiveCase, strandsV2LiveCases } from "./strands-v2-live-evaluation.js";
import { admitAgentV2Reply } from "@raiquora/agent/agent-v2-publication";
const ground = strandsV2LiveCases[0]!, save = strandsV2LiveCases[1]!;
describe("Strands v2 live evaluation policy", () => {
  it("scores selected admitted factual fields, not a fluent unsupported answer", () => {
    expect(evaluateStrandsV2LiveCase(ground, { status: "completed", deliveryBasis: "verified_projection", toolCalls: 1,
      evidenceCount: 1, claimStatuses: ["supported"], response: "資料の記載です。",
      publicReply: { kind: "answer", references: [{ evidenceId: "fixture", field: "sourceExcerpt" }] } })).toEqual([]);
    expect(evaluateStrandsV2LiveCase(ground, { status: "completed", deliveryBasis: "model", toolCalls: 0,
      evidenceCount: 0, claimStatuses: [], response: "京都は素晴らしい場所です。" }))
      .toEqual(expect.arrayContaining(["unadmitted_reply", "read_tool_not_used", "evidence_missing", "unsupported_claim"]));
  });
  it.each(["保存しました。", "保存しておきます。", "保存を承りました。", "保存できません。"])(
    "does not accept prose as proof of an operation result: %s", (response) => {
      expect(evaluateStrandsV2LiveCase(save, { status: "completed", toolCalls: 0, evidenceCount: 0, claimStatuses: [], response }))
        .toContain("unavailable_operation_not_reported");
    });
  it("accepts Application-authored unavailable status without a verb-ending dictionary", () => {
    const admitted = admitAgentV2Reply({ kind: "unavailable", operation: "save" }, { executionId: "live", evidence: [] });
    expect(evaluateStrandsV2LiveCase(save, { status: "completed", toolCalls: 0, evidenceCount: 0, claimStatuses: [],
      response: admitted.text, publicReply: admitted.proof })).toEqual([]);
  });
  it("rejects irrelevant valid conversation rather than calling it successful task completion", () => {
    const admitted = admitAgentV2Reply({ kind: "conversation", message: "greeting" }, { executionId: "live", evidence: [] });
    expect(evaluateStrandsV2LiveCase(save, { status: "completed", toolCalls: 0, evidenceCount: 0, claimStatuses: [],
      response: admitted.text, publicReply: admitted.proof })).toContain("unavailable_operation_not_reported");
  });
  it("classifies provider failures without retaining provider messages", () => {
    const error = new Error("wrapped", { cause: { name: "AccessDeniedException", message: "private", $metadata: { httpStatusCode: 403 } } });
    error.name = "ModelError";
    expect(classifyStrandsV2LiveError(error)).toBe("ModelError/AccessDeniedException/403");
    expect(classifyStrandsV2LiveError(new Error("private"))).toBe("Error");
  });
});
