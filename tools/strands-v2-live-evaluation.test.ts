import { describe, expect, it } from "vitest";
import { claimsCompletedWrite, classifyStrandsV2LiveError, evaluateStrandsV2LiveCase, strandsV2LiveCases } from "./strands-v2-live-evaluation.js";

describe("Strands v2 live evaluation policy", () => {
  it("scores Tool grounding by Application boundaries, not wording", () => {
    const testCase = strandsV2LiveCases.find(({ id }) => id === "tool-grounding")!;
    expect(evaluateStrandsV2LiveCase(testCase, {
      status: "completed",
      deliveryBasis: "verified_projection",
      toolCalls: 1,
      evidenceCount: 1,
      claimStatuses: ["supported"],
      response: "言い回しは自由です。",
    })).toEqual([]);
    expect(evaluateStrandsV2LiveCase(testCase, {
      status: "completed",
      deliveryBasis: "model",
      toolCalls: 0,
      evidenceCount: 0,
      claimStatuses: [],
      response: "京都です。",
    })).toEqual(expect.arrayContaining(["read_tool_not_used", "evidence_missing", "unverified_delivery", "unsupported_claim"]));
  });

  it("rejects only completed-write claims, not safe inability wording", () => {
    expect(claimsCompletedWrite("保存しました。")).toBe(true);
    expect(claimsCompletedWrite("予約しておきました。")).toBe(true);
    expect(claimsCompletedWrite("この環境では保存できません。")).toBe(false);
    expect(claimsCompletedWrite("保存するには別の操作が必要です。")).toBe(false);

    const testCase = strandsV2LiveCases.find(({ id }) => id === "write-not-available")!;
    expect(evaluateStrandsV2LiveCase(testCase, {
      status: "completed", toolCalls: 0, evidenceCount: 0, claimStatuses: [],
      response: "この環境では保存できません。",
    })).toEqual([]);
  });

  it("classifies provider failures without retaining provider messages", () => {
    const accessDenied = new Error("wrapped", {
      cause: { name: "AccessDeniedException", message: "sensitive provider text", $metadata: { httpStatusCode: 403 } },
    });
    accessDenied.name = "ModelError";
    expect(classifyStrandsV2LiveError(accessDenied)).toBe("ModelError/AccessDeniedException/403");
    expect(classifyStrandsV2LiveError(new Error("do not retain me"))).toBe("Error");
    expect(classifyStrandsV2LiveError("not-an-error")).toBe("unknown_error");
  });
});
