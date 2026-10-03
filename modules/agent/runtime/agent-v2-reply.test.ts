import { describe, expect, it } from "vitest";
import { z } from "zod";
import { agentV2ReplySchema, agentV2StructuredOutputSchema, parseAgentV2Reply } from "./agent-v2-reply";

const examples = [
  { kind: "answer", references: [{ evidenceId: "evidence:place", field: "description" }] },
  { kind: "candidates", evidenceIds: ["evidence:place"], commentary: "候補を検討できます。" },
  { kind: "conversation", message: "greeting", text: "こんにちは。何を相談しますか？" }, { kind: "clarification", target: "origin", text: "出発地を教えてください。" },
  { kind: "unavailable", operation: "save" }, { kind: "operation_result", receiptId: "receipt:1" }, { kind: "uncertainty", text: "まだ確認できていません。" },
];
describe("single-source V2 reply syntax", () => {
  it("can ask for the departure time needed by rail search without treating it as a date", () => {
    const reply = { kind: "clarification", target: "departure_time", text: "何時ごろ出発しますか？" };
    expect(agentV2StructuredOutputSchema.parse({ reply }).reply).toEqual(parseAgentV2Reply(reply));
    expect(agentV2StructuredOutputSchema.parse({ reply: { kind: "answer", references: [{ evidenceId: "station", field: "name" }],
      nextQuestion: { target: "departure_time", text: "出発時刻は何時ごろですか？" } } }).reply.kind).toBe("answer");
  });
  it.each(examples)("shares a valid $kind between the SDK envelope and Application parser", (reply) => {
    expect(agentV2StructuredOutputSchema.parse({ reply }).reply).toEqual(parseAgentV2Reply(reply));
  });
  it.each([
    { kind: "candidates" },
    { kind: "conversation", message: "greeting", commentary: "こんにちは" },
    { kind: "conversation", message: "greeting", text: "" },
    { kind: "answer", references: [] },
    { kind: "candidates", evidenceIds: ["evidence:1"], commentary: "説明", cards: [] },
  ])("rejects the same invalid syntax at both boundaries", (reply) => {
    expect(agentV2StructuredOutputSchema.safeParse({ reply }).success).toBe(false);
    expect(() => parseAgentV2Reply(reply)).toThrow();
  });
  it("generates required fields per variant instead of advertising every field as optional", () => {
    const json = z.toJSONSchema(agentV2StructuredOutputSchema) as any;
    expect(json.type).toBe("object");
    expect(json.required).toEqual(["reply"]);
    const variants = json.properties.reply.oneOf ?? json.properties.reply.anyOf;
    expect(variants).toHaveLength(examples.length);
    for (const example of examples) {
      const variant = variants.find((v: any) => v.properties.kind.const === example.kind);
      const requiredExampleKeys = Object.keys(example).filter(key => key !== "text");
      expect(variant.required).toEqual(expect.arrayContaining(requiredExampleKeys));
      expect(variant.additionalProperties).toBe(false);
    }
    expect(agentV2ReplySchema.safeParse({ kind: "candidates" }).success).toBe(false);
  });
});
