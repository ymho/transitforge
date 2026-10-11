import { expect, it } from "vitest";
import { Message, ToolResultBlock, TextBlock, ToolUseBlock } from "@strands-agents/sdk";
import { z } from "zod";
import { strandsModelDiagnostic, strandsReplyReferenceDiagnostic, strandsToolDiagnostic } from "./strands-loop-diagnostic.js";
import type { Evidence } from "@raiquora/agent/evidence-model";

it("separates unknown, omitted and duplicate references without logging identities", () => {
  const evidence = (id: string): Evidence => ({ id, category: "external", knowledgeKind: "deterministic_fact",
    subject: "private subject", facts: { private: "private value" }, references: [] });
  const retained = evidence("private-retained"), omitted = evidence("private-omitted");
  const result = strandsReplyReferenceDiagnostic({ kind: "answer", references: [
    { evidenceId: retained.id, field: "name" }, { evidenceId: retained.id, field: "description" },
    { evidenceId: omitted.id, field: "name" }, { evidenceId: omitted.id, field: "name" },
    { evidenceId: "private-invented", field: "name" },
  ] }, [retained, omitted], [retained], 1);
  expect(result).toEqual({ referenceCount: 5, evidenceCount: 2, retainedEvidenceCount: 1, omittedEvidenceCount: 1,
    unknownReferenceCount: 1, omittedReferenceCount: 2, duplicateReferenceCount: 1 });
  expect(JSON.stringify(result)).not.toContain("private");
});

it("keeps usage and registered Tool names without text, input, or private metadata", () => {
  const message = new Message({ role: "assistant", content: [new TextBlock("private answer"),
    new ToolUseBlock({ name: "explore_destination", toolUseId: "private-id", input: { destination: "private place" } }),
    new ToolUseBlock({ name: "private-unknown", toolUseId: "private-id", input: {} })],
    metadata: { usage: { inputTokens: 50, outputTokens: 4096, totalTokens: 4146 } } });
  const result = strandsModelDiagnostic(message, new Set(["explore_destination"]));
  expect(result).toEqual({ inputTokens: 50, outputTokens: 4096, totalTokens: 4146, textBlocks: 1, reasoningBlocks: 0,
    toolBlocks: 2, tools: ["explore_destination", "unknown_tool"] });
  expect(JSON.stringify(result)).not.toContain("private");
});
it("distinguishes an Application rejection carried by an SDK success result", () => {
  const result = new ToolResultBlock({ toolUseId: "private-id", status: "success", content: [new TextBlock(JSON.stringify({
    ok: false, error: { code: "precondition_failed", message: "private explanation" } }))] });
  expect(strandsToolDiagnostic(result)).toEqual({ outcome: "rejected", code: "precondition_failed" });
});
it("reports schema issue categories without paths, input, or error messages", () => {
  const parsed = z.strictObject({ count: z.number() }).safeParse({ count: "private value", "private key": 1 });
  if (parsed.success) throw Error("fixture must reject");
  const result = new ToolResultBlock({ toolUseId: "private-id", status: "error", content: [new TextBlock("private error")], error: parsed.error });
  expect(strandsToolDiagnostic(result)).toEqual({ outcome: "rejected", code: "schema_invalid", issues: ["invalid_type", "unrecognized_keys"] });
  expect(JSON.stringify(strandsToolDiagnostic(result))).not.toContain("private");
});
