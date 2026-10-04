import { z } from "zod";
import type { AgentV2OperationReceipt } from "@raiquora/agent/agent-v2-reply";
import type { ConversationMessage } from "./server-state.js";

export const presentedCandidateSelectionSchema = z.strictObject({
  presentationId: z.string().min(1).max(160), candidateId: z.string().min(1).max(240),
  quote: z.string().min(1).max(600),
}).describe("CURRENT userMessageで明示された候補の採用・保存。対象IDだけを渡し、候補本文・保存データ・確認keyを生成しない。比較・仮定・推薦依頼では使わない。");
export type PresentedCandidateSelection = z.infer<typeof presentedCandidateSelectionSchema>;
export type CandidateKind = "plan" | "journey" | "accommodation" | "place";
export interface PresentedCandidateGroup {
  presentationId: string; kind: CandidateKind;
  candidates: { candidateId: string; ordinal: number; label: string }[];
}
export interface PresentedCandidateController {
  context: { groups: PresentedCandidateGroup[]; itineraryItemCount: number; canSave: boolean };
  review(presentationId: string): Promise<{ status: "shown" | "missing"; group?: PresentedCandidateGroup }>;
  select(input: PresentedCandidateSelection): Promise<{ status: "saved"; receipt: AgentV2OperationReceipt; tripId: string; tripRevision: number } |
    { status: "unavailable" | "stale" | "invalid_source" | "unknown_candidate" }>;
}
export type CandidatePresentation = Pick<ConversationMessage, "publicPlanPresentation" | "publicJourneyPresentation" | "publicAccommodationPresentation" | "publicPlacePresentation">;

