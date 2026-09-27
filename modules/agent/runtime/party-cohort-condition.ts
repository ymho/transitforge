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
export const partyDetailsUpdateInputSchema = z.strictObject({
  action: z.enum(["set", "clear"]).describe("setは最終状態への全体置換。取消しと新条件の指定は1回のset。clearは最終的に詳細を未定へ戻す場合のみ。"),
  cohorts: partyCohortValueSchema.optional().describe("重複しない匿名集団の最終状態。変更も撤回もされていない明示済み属性は維持し、撤回された属性は除く。不明な属性や人数合わせの集団は補完しない。"),
  quote: z.string().min(1).max(300),
}).superRefine((value, context) => {
  if (value.action === "set" && value.cohorts === undefined || value.action === "clear" && value.cohorts !== undefined)
    context.addIssue({ code: "custom", message: "set requires cohorts; clear forbids cohorts" });
});
/** Stored resolved scope is Application-owned, never part of a model Tool schema. */
export const resolvedPartyCohortsSchema = z.custom<PartyCohort[]>((value: unknown) => {
  try { parsePartyCohorts(value); return true; } catch { return false; }
});
