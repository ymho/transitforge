import { z } from "zod";
import { schoolStages, ageDecades, parsePartyCohorts, type PartyCohort } from "@raiquora/trip/party-cohorts";

const scopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("whole_trip") }),
  z.strictObject({ kind: z.literal("logical_days"), fromDay: z.number().int().min(1).max(90).optional(), toDay: z.number().int().min(1).max(90).optional() })
    .refine(value => value.fromDay !== undefined || value.toDay !== undefined, { message: "日範囲は開始または終了日が必要" }),
  z.strictObject({ kind: z.literal("segment"), segmentNumber: z.number().int().min(1).max(180) }),
]);
export const partyCohortValueSchema = z.array(z.strictObject({
  count: z.number().int().min(1).max(20),
  membership: z.enum(["baseline", "additional"]).describe("baselineは全行程人数の一部を説明。additionalは限定範囲で加わる人数。全行程人数へ加算しない。"),
  schoolStage: z.enum(schoolStages).optional(),
  ageDecade: z.enum(ageDecades).optional(),
  exactAge: z.number().int().min(0).max(120).optional().describe("本人が明示した正確な年齢のみ。年代/学年から生成しない。"),
  scope: scopeSchema.describe("日・区間はApplicationの既知scope選択肢から番号で指定。raw IDは禁止。fromDay省略は初日、toDay省略は既知の最終日。"),
})).min(1).max(20);
/** This is a replacement value, not a sequence of clear/set commands. */
export const partyDetailsUpdateInputSchema = z.strictObject({
  finalCohorts: partyCohortValueSchema.nullable().describe("利用者の発言全体を反映した、更新後に残す同行者詳細の集合。既存集合をこの値で置換する。取消しと新条件が同じ発言なら新条件の集合だけを渡す。最終的に詳細がすべて未定となる場合だけnull。変更も撤回もされていない明示済み属性は維持する。不明な属性や人数合わせの集団は補完しない。"),
  quote: z.string().min(1).max(300),
});
/** Stored resolved scope is Application-owned, never part of a model Tool schema. */
export const resolvedPartyCohortsSchema = z.custom<PartyCohort[]>((value: unknown) => {
  try { parsePartyCohorts(value); return true; } catch { return false; }
});
