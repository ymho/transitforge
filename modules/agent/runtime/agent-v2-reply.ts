import { z } from "zod";

/** One syntax definition for TypeScript, SDK JSON Schema and Application parsing.
 * References authorize nothing: Evidence/currentness/receipts are checked by admission. */
export const replyOperations = ["save", "change", "book", "pay"] as const;
export type ReplyOperation = typeof replyOperations[number];
export const replyQuestions = ["goal", "origin", "destination", "start_date", "departure_time", "duration", "party_size", "budget", "participation_scope"] as const;
export type ReplyQuestion = typeof replyQuestions[number];
const identifier = (maximum: number) => z.string().min(1).max(maximum)
  .regex(/^(?!\s)(?![\s\S]*\s$)[^\u0000-\u001f\u007f<>]+$/u);
const reference = z.strictObject({ evidenceId: identifier(240), field: z.string().min(1).max(80).regex(/^[a-zA-Z][a-zA-Z0-9_]*$/u) });
export type ReplyReference = z.infer<typeof reference>;
const commentary = z.string().min(1).max(1200).describe("Selected Evidenceに基づく説明・比較・推薦。未確認の時刻・料金・操作結果を作らない。");
const conversationalText = z.string().min(1).max(600)
  .describe("短い自然な会話文。利用者発言とApplicationの現在条件を説明・確認するためだけに使い、外部事実や未検証の操作成功を作らない。");
const sections = z.array(z.strictObject({
  heading: z.string().min(1).max(40), text: z.string().min(1).max(240),
})).min(1).max(4).describe("参照したEvidenceに基づく短い話題別説明。見出しは内容から選ぶ。概要・アクセス・イベントなど必要な話題だけを使い、各節1〜2文。commentaryと重複させない。");
const nextQuestion = z.strictObject({ target: z.enum(replyQuestions), text: z.string().min(1).max(200) })
  .describe("回答の後に相談を進めるための質問を1つ。現在の条件と利用者の関心から選び、既知の条件を単に聞き直さない。外部事実や操作の成功を含めない。");
export const agentV2ReplySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("answer").describe("外部情報を確認した事実回答。実在するEvidence参照が必須。通常の会話・確認・仮定の説明はconversation/clarification/uncertainty。"), references: z.array(reference).min(1).max(8), commentary: commentary.optional(), sections: sections.optional(), nextQuestion: nextQuestion.optional() }),
  z.strictObject({ kind: z.literal("candidates").describe("ToolのcandidateReferencesにある観光地または宿泊施設の候補一覧。カードはApplicationが作る。"), evidenceIds: z.array(identifier(240)).min(1).max(8), commentary, nextQuestion: nextQuestion.optional() }),
  z.strictObject({ kind: z.literal("conversation"), message: z.enum(["greeting", "thanks", "acknowledgement"]), text: conversationalText.optional() }),
  z.strictObject({ kind: z.literal("clarification").describe("実行できる相談・検索・提案に必要な入力を確認する質問。要求された保存・変更・予約・決済のToolが提供されていなければ、対象詳細を質問せずunavailableで操作能力がないことを示す。入力不足と能力不足を区別する。"), target: z.enum(replyQuestions), text: conversationalText.optional() }),
  z.strictObject({ kind: z.literal("unavailable").describe("提供されていない保存・変更・予約・決済を求められた時の応答。操作対象の詳細が不明でも、実行できない能力はこの型で明示する。"), operation: z.enum(replyOperations) }),
  z.strictObject({ kind: z.literal("operation_result"), receiptId: identifier(240) }),
  z.strictObject({ kind: z.literal("uncertainty"), text: conversationalText.optional() }),
]);
export type AgentV2ReplyProposal = z.infer<typeof agentV2ReplySchema>;
/** The object envelope is the SDK Tool's input; the variant is nested, not flattened. */
export const agentV2StructuredOutputSchema = z.strictObject({ reply: agentV2ReplySchema })
  .describe("今回の依頼に必要な条件受理・検索・案作成を終えた後の最終回答。条件受理だけでは検索・案作成の依頼を完了できない。宿の検索後はanswerへ宿のreplyReferencesを選ぶか、candidatesへcandidateReferencesのevidenceIdを選ぶ。仮旅程作成後はconversationで案の確認方法と不足を短く案内する。replyだけを返し、カード本体や新たな事実・実行結果は生成しない。");

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
