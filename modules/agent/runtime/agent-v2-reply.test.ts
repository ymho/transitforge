import { describe, expect, it } from "vitest";
import { z } from "zod";
import { agentV2ReplySchema, agentV2StructuredOutputSchema, parseAgentV2Reply } from "./agent-v2-reply";

const examples = [
  { kind: "answer", references: [{ evidenceId: "evidence:place", field: "description" }] },
  { kind: "candidates", evidenceIds: ["evidence:place"], commentary: "候補を検討できます。" },
  { kind: "conversation", message: "greeting" }, { kind: "clarification", target: "origin" },
  { kind: "unavailable", operation: "save" }, { kind: "operation_result", receiptId: "receipt:1" }, { kind: "uncertainty" },
];
describe("single-source V2 reply syntax", () => {
  it.each(examples)("shares a valid $kind between the SDK envelope and Application parser", (reply) => {
    expect(agentV2StructuredOutputSchema.parse({ reply }).reply).toEqual(parseAgentV2Reply(reply));
  });
  it.each([
    { kind: "candidates" },
    { kind: "conversation", message: "greeting", commentary: "こんにちは" },
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
      expect(variant.required).toEqual(expect.arrayContaining(Object.keys(example)));
      expect(variant.additionalProperties).toBe(false);
    }
    expect(agentV2ReplySchema.safeParse({ kind: "candidates" }).success).toBe(false);
  });
});
