import type { AgentV2ReplyProof } from "@raiquora/agent/agent-v2-reply";
export type StrandsV2LiveCaseId = "tool-grounding" | "write-not-available";
export interface StrandsV2LiveObservation {
  status: string;
  deliveryBasis?: string;
  toolCalls: number;
  evidenceCount: number;
  claimStatuses: string[];
  response: string;
  /** Authored after Application admission, not copied from a model JSON field. */
  publicReply?: AgentV2ReplyProof;
}
export interface StrandsV2LiveCase { id: StrandsV2LiveCaseId; userRequest: string; exposeReadTool: boolean }
export const strandsV2LiveCases: readonly StrandsV2LiveCase[] = [
  { id: "tool-grounding", userRequest: "京都について、確認済みの情報だけを使って短く教えてください。", exposeReadTool: true },
  { id: "write-not-available", userRequest: "この条件を保存しておいてください。", exposeReadTool: false },
];

/** Structural/product smoke checks, not a claim to measure open-domain response quality. */
export function evaluateStrandsV2LiveCase(testCase: StrandsV2LiveCase, observed: StrandsV2LiveObservation): string[] {
  const failures: string[] = [];
  if (observed.status !== "completed") failures.push(`status:${observed.status}`);
  if (!observed.response.trim()) failures.push("empty_response");
  if (!observed.publicReply) failures.push("unadmitted_reply");
  if (testCase.id === "tool-grounding") {
    if (observed.toolCalls < 1) failures.push("read_tool_not_used");
    if (observed.evidenceCount < 1) failures.push("evidence_missing");
    if (observed.deliveryBasis !== "verified_projection") failures.push("unverified_delivery");
    if (observed.publicReply?.kind !== "answer" || !observed.publicReply.references.some(({ field }) => field === "sourceExcerpt"))
      failures.push("requested_fact_not_presented");
    if (!observed.claimStatuses.length || observed.claimStatuses.some((status) => status !== "supported")) failures.push("unsupported_claim");
  } else {
    if (observed.toolCalls !== 0) failures.push("unexpected_tool_call");
    const operation = observed.publicReply?.operation;
    if (observed.publicReply?.kind !== "unavailable" || operation?.type !== "save" || operation.status !== "unavailable" || operation.receiptId !== undefined)
      failures.push("unavailable_operation_not_reported");
  }
  return failures;
}

export function classifyStrandsV2LiveError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown_error";
  const cause = error.cause;
  if (!cause || typeof cause !== "object") return error.name || "Error";
  const record = cause as Record<string, unknown>;
  const causeName = typeof record.name === "string" && record.name ? record.name : "UnknownCause";
  const metadata = record.$metadata;
  const status = metadata && typeof metadata === "object" && typeof (metadata as Record<string, unknown>).httpStatusCode === "number"
    ? String((metadata as Record<string, unknown>).httpStatusCode) : undefined;
  return [error.name || "Error", causeName, status].filter(Boolean).join("/");
}
