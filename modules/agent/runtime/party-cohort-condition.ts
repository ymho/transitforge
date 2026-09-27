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
  membership: z.enum(["baseline", "additional"]).describe("baselineは既存の全体人数に含まれる人、additionalはその外から限定参加する人。baselineでも途中離脱できる。参加期間はscopeだけで表す。"),
  schoolStage: z.enum(schoolStages).optional(),
  ageDecade: z.enum(ageDecades).optional(),
  exactAge: z.number().int().min(0).max(120).optional().describe("本人が明示した正確な年齢のみ。年代/学年から生成しない。"),
  scope: scopeSchema.describe("この集団が実際に参加する範囲。同じ人の属性行と参加行に分けない。既知の日/区間の番号のみ指定しraw IDは禁止。fromDay省略は初日、toDay省略は既知の最終日。"),
})).min(1).max(20);
/** This is a replacement value, not a sequence of clear/set commands. */
export const partyDetailsUpdateInputSchema = z.strictObject({
  finalCohorts: partyCohortValueSchema.nullable().describe("更新後の重複しない集団の全集合。1要素は同じ人たちの人数・属性・参加範囲をまとめた値。既存の人の訂正はその要素を置換し、旧要素を残して追加しない。別の人が増えた場合だけ要素を追加する。変更されない人と明示済み属性は維持する。離脱後の不参加行や人数合わせの集団は不要。対象の人を特定できない時はこのToolを呼ばず確認する。取消しと新条件も最終集合を1回で提出し、全詳細の明示撤回だけnull。"),
  quote: z.string().min(1).max(300),
});
/** Stored resolved scope is Application-owned, never part of a model Tool schema. */
export const resolvedPartyCohortsSchema = z.custom<PartyCohort[]>((value: unknown) => {
  try { parsePartyCohorts(value); return true; } catch { return false; }
});
