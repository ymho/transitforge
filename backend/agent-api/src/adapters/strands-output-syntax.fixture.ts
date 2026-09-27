import { agentV2StructuredOutputSchema } from "@raiquora/agent/agent-v2-reply";

const fields = new Set(["reply", "kind", "text", "commentary", "message", "target", "references", "evidenceIds", "receiptId", "operation"]);
const codes = new Set(["unrecognized_keys", "invalid_type", "invalid_value", "invalid_union", "too_small", "too_big", "invalid_format", "custom"]);
const kinds = new Set(["answer", "candidates", "conversation", "clarification", "uncertainty", "unavailable", "operation_result"]);

/** Read-only test diagnostics. Unknown paths/values, prose and validation messages
 * never leave the fixture. This does not replace the SDK parser or repair input. */
export function outputSyntaxDiagnostic(value: unknown) {
  const parsed = agentV2StructuredOutputSchema.safeParse(value);
  const reply = value && typeof value === "object" && "reply" in value ? value.reply : undefined;
  const kind = reply && typeof reply === "object" && "kind" in reply ? reply.kind : undefined;
  return { valid: parsed.success, kind: typeof kind === "string" && kinds.has(kind) ? kind : "unknown",
    issues: parsed.success ? [] : parsed.error.issues.slice(0, 8).map(issue => ({
      code: codes.has(issue.code) ? issue.code : "other",
      path: issue.path.slice(0, 6).map(key => typeof key === "number" ? "index" : fields.has(String(key)) ? String(key) : "other"),
      ...(issue.code === "unrecognized_keys" ? { keys: issue.keys.slice(0, 8).map(key => fields.has(key) ? key : "other") } : {}),
    })) };
}
