import { z } from "zod";
import { schoolStages, ageDecades, parsePartyCohorts, type PartyCohort } from "@raiquora/trip/party-cohorts";

const scopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("whole_trip") }),
  z.strictObject({
    kind: z.literal("logical_days"),
    fromDay: z.number().int().min(1).max(90).optional().describe("参加を始める日番号。離脱日ではない。省略時は1日目。"),
    toDay: z.number().int().min(1).max(90).optional().describe("参加する最後の日番号。この日を含む。N日目まで参加ならN。省略時は旅程の最終日。"),
  }).refine(value => value.fromDay !== undefined || value.toDay !== undefined, { message: "日範囲は開始または終了日が必要" }),
  z.strictObject({ kind: z.literal("segment"), segmentNumber: z.number().int().min(1).max(180) }),
]);
export const partyCohortValueSchema = z.array(z.strictObject({
  count: z.number().int().min(1).max(20),
  membership: z.enum(["baseline", "additional"]).describe("baselineは既存の全体人数に含まれる人、additionalはその外から限定参加する人。baselineでも途中離脱できる。参加期間はscopeだけで表す。"),
  schoolStage: z.enum(schoolStages).optional(),
  ageDecade: z.enum(ageDecades).optional(),
  exactAge: z.number().int().min(0).max(120).optional().describe("本人が明示した正確な年齢のみ。年代/学年から生成しない。"),
  scope: scopeSchema.describe("この集団が実際に参加する範囲。同じ人の属性行と参加行に分けない。既知の日/区間の番号のみ指定しraw IDは禁止。"),
})).min(1).max(20);
/** This is a replacement value, not a sequence of clear/set commands. */
export const partyDetailsUpdateInputSchema = z.strictObject({
  finalCohorts: partyCohortValueSchema.nullable().describe("既存の詳細を全て取り消す・未定に戻す依頼はnull。合計人数だけを残すための集団は不要。指定・訂正の場合はapplication.currentPartyDetailsへ今回の変更だけを反映した全集合。同じ人の訂正は置換し、参加範囲だけの訂正では既存schoolStage/ageDecade等を保持する。変更されない集団も残す。どの人への変更か未特定・未決定ならこのToolを呼ばずclarificationで確認する。対象を推測したり区別する属性を消したりして更新しない。"),
  quote: z.string().min(1).max(300),
});
/** Stored resolved scope is Application-owned, never part of a model Tool schema. */
export const resolvedPartyCohortsSchema = z.custom<PartyCohort[]>((value: unknown) => {
  try { parsePartyCohorts(value); return true; } catch { return false; }
});
