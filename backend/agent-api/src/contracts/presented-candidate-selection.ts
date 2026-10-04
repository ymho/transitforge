import { z } from "zod";
import type { AgentV2OperationReceipt } from "@raiquora/agent/agent-v2-reply";
import type { ConversationMessage } from "./server-state.js";

export const presentedCandidateSelectionSchema = z.strictObject({
  presentationId: z.string().min(1).max(160), candidateId: z.string().min(1).max(240),
  quote: z.string().min(1).max(600),
  reference: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("label"), quote: z.string().min(1).max(600) }),
    z.strictObject({ kind: z.literal("ordinal"), ordinal: z.number().int().min(1).max(20), quote: z.string().min(1).max(4).regex(/^[0-9０-９]+$/u).describe("番号の数字だけをそのまま引用する。例: 経路2でお願いします → quote=2, ordinal=2。") }),
    z.strictObject({ kind: z.literal("sole") }),
  ]).describe("CURRENT quoteに含まれる選んだ名前(label)または表示番号の数字(ordinal)をそのまま引用する。soleは全候補群を通じて候補が1つの場合だけ。否定された案から別案の採用を推論しない。"),
}).describe("CURRENT userMessageで肯定的に明示された候補の採用・保存。対象IDと選択の引用だけを渡す。候補本文・保存データ・確認keyを生成しない。案2を保存しないという発言は案1の採用ではなく、このToolを使わない。比較・仮定・推薦依頼でも使わない。");
export type PresentedCandidateSelection = z.infer<typeof presentedCandidateSelectionSchema>;
export type CandidateKind = "plan" | "journey" | "accommodation" | "place";
export interface PresentedCandidateGroup {
  presentationId: string; kind: CandidateKind;
  candidates: { candidateId: string; ordinal: number; label: string }[];
}
export interface PresentedCandidateController {
  context: { groups: PresentedCandidateGroup[]; itineraryItemCount: number; canSave: boolean };
  review(presentationId?: string): Promise<{ status: "shown" | "missing" | "ambiguous"; group?: PresentedCandidateGroup;
    navigation?: { target: "itinerary_target"; text: string } }>;
  select(input: PresentedCandidateSelection): Promise<{ status: "saved"; receipt: AgentV2OperationReceipt; tripId: string; tripRevision: number } |
    { status: "unavailable" | "stale" | "invalid_source" | "unknown_candidate" }>;
}
export type CandidatePresentation = Pick<ConversationMessage, "publicPlanPresentation" | "publicJourneyPresentation" | "publicAccommodationPresentation" | "publicPlacePresentation">;
