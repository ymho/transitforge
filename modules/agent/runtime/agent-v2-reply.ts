import { z } from "zod";

/** One syntax definition for TypeScript, SDK JSON Schema and Application parsing.
 * References authorize nothing: Evidence/currentness/receipts are checked by admission. */
export const replyOperations = ["save", "change", "book", "pay"] as const;
export type ReplyOperation = typeof replyOperations[number];
export const replyQuestions = ["goal", "origin", "destination", "start_date", "duration", "party_size", "budget"] as const;
export type ReplyQuestion = typeof replyQuestions[number];
const identifier = (maximum: number) => z.string().min(1).max(maximum)
  .regex(/^(?!\s)(?![\s\S]*\s$)[^\u0000-\u001f\u007f<>]+$/u);
const reference = z.strictObject({ evidenceId: identifier(240), field: z.string().min(1).max(80).regex(/^[a-zA-Z][a-zA-Z0-9_]*$/u) });
export type ReplyReference = z.infer<typeof reference>;
const commentary = z.string().min(1).max(1200).describe("Selected Evidenceに基づく説明・比較・推薦。未確認の時刻・料金・操作結果を作らない。");
export const agentV2ReplySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("answer"), references: z.array(reference).min(1).max(8), commentary: commentary.optional() }),
  z.strictObject({ kind: z.literal("candidates"), evidenceIds: z.array(identifier(240)).min(1).max(8), commentary }),
  z.strictObject({ kind: z.literal("conversation"), message: z.enum(["greeting", "thanks", "acknowledgement"]) }),
  z.strictObject({ kind: z.literal("clarification"), target: z.enum(replyQuestions) }),
  z.strictObject({ kind: z.literal("unavailable"), operation: z.enum(replyOperations) }),
  z.strictObject({ kind: z.literal("operation_result"), receiptId: identifier(240) }),
  z.strictObject({ kind: z.literal("uncertainty") }),
]);
export type AgentV2ReplyProposal = z.infer<typeof agentV2ReplySchema>;
/** The object envelope is the SDK Tool's input; the variant is nested, not flattened. */
export const agentV2StructuredOutputSchema = z.strictObject({ reply: agentV2ReplySchema })
  .describe("必要なread/条件受理の後の最終回答。replyだけを返す。カード本体や新たな事実・実行結果は生成しない。");

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

/** No handwritten variant parser and no response repair. */
export function parseAgentV2Reply(value: unknown): AgentV2ReplyProposal {
  const parsed = agentV2ReplySchema.safeParse(value);
  if (!parsed.success) throw new AgentV2ReplyError("invalid_proposal");
  return parsed.data;
}
