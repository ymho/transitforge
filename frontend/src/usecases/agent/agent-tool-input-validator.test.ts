import { describe, expect, it } from "vitest";

import { validateAgentToolInput } from "./agent-tool-input-validator";

const schema = {
  type: "object" as const,
  properties: {
    destination: { type: "string" },
    date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    stayNights: { type: "integer", enum: [0], minimum: 0 },
    tags: { type: "array", maxItems: 2, items: { type: "string" } },
    context: {
      type: "object",
      properties: { maximumTravelMinutes: { type: ["number", "null"] } },
      additionalProperties: false,
    },
  },
  required: ["destination", "date", "stayNights"],
  additionalProperties: false,
};

describe("validateAgentToolInput", () => {
  it("公開したTool contractに一致する構造化入力を受理する", () => {
    expect(validateAgentToolInput(schema, {
      destination: "奈良公園",
      date: "2026-09-03",
      stayNights: 0,
      tags: ["nature"],
      context: { maximumTravelMinutes: null },
    })).toMatchObject({ ok: true });
  });

  it.each([
    [{ destination: "奈良公園", stayNights: 0 }, "入力.dateは必須です。"],
    [{ destination: "奈良公園", date: "明日", stayNights: 0 }, "入力.dateの形式が不正です。"],
    [{ destination: "奈良公園", date: "2026-09-03", stayNights: 1 }, "入力.stayNightsは許可された値ではありません。"],
    [{ destination: "奈良公園", date: "2026-09-03", stayNights: 0, unknown: true }, "入力.unknownはTool contractにありません。"],
    [{ destination: "奈良公園", date: "2026-09-03", stayNights: 0, tags: ["a", "b", "c"] }, "入力.tagsの要素数が上限を超えています。"],
  ])("不正な入力を理由付きで拒否する", (input, message) => {
    expect(validateAgentToolInput(schema, input)).toEqual({
      ok: false,
      error: { code: "invalid_input", message, retryable: false },
    });
  });
});
