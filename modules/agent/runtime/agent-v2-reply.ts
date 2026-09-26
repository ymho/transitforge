/** The model selects references and explains them. Only the Application may admit
 * Evidence payloads, public cards or mutation receipts for publication. */
export const replyOperations = ["save", "change", "book", "pay"] as const;
export type ReplyOperation = typeof replyOperations[number];
export const replyQuestions = ["goal", "origin", "destination", "start_date", "duration", "party_size", "budget"] as const;
export type ReplyQuestion = typeof replyQuestions[number];
export interface ReplyReference { evidenceId: string; field: string }
export type AgentV2ReplyProposal =
  | { kind: "answer"; references: ReplyReference[]; commentary?: string }
  | { kind: "candidates"; evidenceIds: string[]; commentary: string }
  | { kind: "conversation"; message: "greeting" | "thanks" | "acknowledgement" }
  | { kind: "clarification"; target: ReplyQuestion }
  | { kind: "unavailable"; operation: ReplyOperation }
  | { kind: "operation_result"; receiptId: string }
  | { kind: "uncertainty" };

/** Trusted Application input, never a field in the model's reply schema.
 * The current read-only composition supplies no receipts. */
export interface AgentV2OperationReceipt {
  id: string;
  executionId: string;
  operation: ReplyOperation;
  status: "succeeded" | "failed" | "pending";
}
export interface AgentV2ReplyProof {
  kind: AgentV2ReplyProposal["kind"];
  references: ReplyReference[];
  question?: ReplyQuestion;
  operation?: { type: ReplyOperation; status: "unavailable" | "succeeded"; receiptId?: string };
  /** Presence only. Raw model commentary is not retained in the proof. */
  commentary?: boolean;
}
export class AgentV2ReplyError extends Error {
  constructor(readonly code: "invalid_proposal" | "missing_evidence" | "ineligible_evidence" |
    "invalid_field" | "known_condition" | "operation_available" | "invalid_receipt" | "unsafe_content") {
    super(`Agent v2 reply rejected: ${code}`);
    this.name = "AgentV2ReplyError";
  }
}

/** Flat schema; parseAgentV2Reply checks each variant's exact field set as well. */
export const agentV2ReplySchema = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["answer", "candidates", "conversation", "clarification", "unavailable", "operation_result", "uncertainty"] },
    commentary: { type: "string", minLength: 1, maxLength: 1200 },
    evidenceIds: { type: "array", minItems: 1, maxItems: 8, uniqueItems: true,
      items: { type: "string", minLength: 1, maxLength: 240 } },
    references: { type: "array", minItems: 1, maxItems: 8, items: {
      type: "object", properties: { evidenceId: { type: "string", minLength: 1, maxLength: 240 },
        field: { type: "string", minLength: 1, maxLength: 80 } },
      required: ["evidenceId", "field"], additionalProperties: false,
    } },
    message: { type: "string", enum: ["greeting", "thanks", "acknowledgement"] },
    target: { type: "string", enum: [...replyQuestions] },
    operation: { type: "string", enum: [...replyOperations] },
    receiptId: { type: "string", minLength: 1, maxLength: 240 },
  },
  required: ["kind"], additionalProperties: false,
};

export function parseAgentV2Reply(value: unknown): AgentV2ReplyProposal {
  if (!record(value)) return invalid();
  switch (value.kind) {
    case "candidates": {
      if (!exact(value, ["kind", "evidenceIds", "commentary"]) || !Array.isArray(value.evidenceIds) ||
          value.evidenceIds.length < 1 || value.evidenceIds.length > 8 || !value.evidenceIds.every((id) => identifier(id, 240)) ||
          new Set(value.evidenceIds).size !== value.evidenceIds.length) return invalid();
      return { kind: "candidates", evidenceIds: [...value.evidenceIds] as string[], commentary: replyCommentary(value.commentary) };
    }
    case "answer": {
      if (!(exact(value, ["kind", "references"]) || exact(value, ["kind", "references", "commentary"])) ||
          !Array.isArray(value.references) || value.references.length < 1 || value.references.length > 8) return invalid();
      const references: ReplyReference[] = [];
      const seen = new Set<string>();
      for (const item of value.references) {
        if (!record(item) || !exact(item, ["evidenceId", "field"]) || !identifier(item.evidenceId, 240) ||
            !identifier(item.field, 80) || !/^[a-zA-Z][a-zA-Z0-9_]*$/u.test(item.field)) return invalid();
        const key = `${item.evidenceId}\u0000${item.field}`;
        if (seen.has(key)) return invalid();
        seen.add(key);
        references.push({ evidenceId: item.evidenceId, field: item.field });
      }
      const commentary = value.commentary === undefined ? undefined : replyCommentary(value.commentary);
      return { kind: "answer", references, ...(commentary ? { commentary } : {}) };
    }
    case "conversation":
      if (!exact(value, ["kind", "message"]) || typeof value.message !== "string" || !["greeting", "thanks", "acknowledgement"].includes(value.message)) return invalid();
      return { kind: "conversation", message: value.message as "greeting" | "thanks" | "acknowledgement" };
    case "clarification":
      if (!exact(value, ["kind", "target"]) || !replyQuestions.includes(value.target as ReplyQuestion)) return invalid();
      return { kind: "clarification", target: value.target as ReplyQuestion };
    case "unavailable":
      if (!exact(value, ["kind", "operation"]) || !replyOperations.includes(value.operation as ReplyOperation)) return invalid();
      return { kind: "unavailable", operation: value.operation as ReplyOperation };
    case "operation_result":
      if (!exact(value, ["kind", "receiptId"]) || !identifier(value.receiptId, 240)) return invalid();
      return { kind: "operation_result", receiptId: value.receiptId };
    case "uncertainty":
      if (!exact(value, ["kind"])) return invalid();
      return { kind: "uncertainty" };
    default: return invalid();
  }
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function exact(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function identifier(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && value.trim() === value &&
    !/[\u0000-\u001f\u007f<>]/u.test(value);
}
function replyCommentary(value: unknown): string {
  if (typeof value !== "string" || value.length > 1200 || value.trim() !== value || !value ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) ||
      /<\s*\/?\s*(?:thinking|analysis|reasoning|think)(?:\s|>|\/)/iu.test(value)) return invalid();
  return value;
}
function invalid(): never { throw new AgentV2ReplyError("invalid_proposal"); }
