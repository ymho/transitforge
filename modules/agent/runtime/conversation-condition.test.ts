import { describe, expect, it } from "vitest";
import { z } from "zod";
import { admitConditionChange, admitTripScenario, conditionDelta, conditionOperationId, conditionPayload, placeConditionUpdateInputSchema, partyConditionUpdateInputSchema, travelPeriodUpdateInputSchema, tripScenarioInputSchema } from "./conversation-condition";
import { reduceConversationIntent } from "./conversation-intent-reducer";
import { compileEffectiveIntent } from "./effective-intent";
import type { ConversationIntentOverlay } from "@raiquora/trip/conversation-intent";
const turn = "71600000-0000-4000-8000-000000000001";
const empty = (): ConversationIntentOverlay => ({ version: 1, intentRevision: 0, facts: [], tombstones: [], appliedMutationIds: [] });

describe("small Conversation condition operations", () => {
  it("has one strict update syntax per condition with no interpretation metadata or model-selected authority", () => {
    const schema = z.toJSONSchema(placeConditionUpdateInputSchema);
    expect(JSON.stringify(schema)).toContain("action");
    expect(placeConditionUpdateInputSchema.safeParse({ action: "set", place: "京都", quote: "京都" }).success).toBe(true);
    expect(placeConditionUpdateInputSchema.safeParse({ action: "clear", quote: "未定に戻す" }).success).toBe(true);
    expect(placeConditionUpdateInputSchema.safeParse({ action: "clear", place: "京都", quote: "京都" }).success).toBe(false);
    expect(placeConditionUpdateInputSchema.safeParse({ action: "set", place: null, quote: "未定に戻す" }).success).toBe(false);
    expect(partyConditionUpdateInputSchema.safeParse({ action: "set", party: { kind: "count", people: 2 }, quote: "2人で" }).success).toBe(true);
    expect(partyConditionUpdateInputSchema.safeParse({ action: "clear", quote: "人数は未定" }).success).toBe(true);
    for (const extra of ["owner", "turnId", "revision", "mutationId", "speechAct", "outcome", "operations", "atomicGroup"])
      expect(placeConditionUpdateInputSchema.safeParse({ action: "set", place: "京都", quote: "京都", [extra]: "injected" }).success).toBe(false);
  });
  it("rejects missing values, unsupported types and labels not grounded in the current message", () => {
    for (const input of [{ quote: "京都" }, { place: 2, quote: "京都" }, { place: "京都", quote: "大阪" }])
      expect(() => admitConditionChange({ target: "destination", ...input }, "京都に行きたい")).toThrow();
    expect(() => admitConditionChange({ target: "destination", place: "神戸", quote: "京都" }, "京都に行きたい")).toThrow("invalid_source");
  });
  it("sets, replaces and retracts without an interpreter and preserves independent conditions", () => {
    let overlay = empty();
    for (const [index, change] of [
      { target: "origin", place: "大阪", quote: "大阪" },
      { target: "destination", place: "京都", quote: "京都" },
      { target: "destination", place: "神戸", quote: "神戸" },
      { target: "destination", place: null, quote: "未定" },
    ].entries()) {
      const accepted = admitConditionChange(change, "大阪 京都 神戸 未定");
      overlay = reduceConversationIntent(overlay, conditionDelta(accepted, `71600000-0000-4000-8000-00000000000${index + 1}`, overlay)).overlay;
    }
    expect(overlay.facts.map(({ target, value }) => ({ target, value }))).toEqual([{ target: "origin", value: { kind: "place_label", label: "大阪" } }]);
    expect(overlay.tombstones).toContainEqual(expect.objectContaining({ target: "destination" }));
    expect(compileEffectiveIntent({ overlay }).actualConversationFacts).toHaveLength(1);
  });
  it("keeps total-only party separate from an explicit adult/child composition without guessing ages", () => {
    expect(partyConditionUpdateInputSchema.safeParse({ action: "set", party: { kind: "count", people: 2 }, quote: "2人で" }).success).toBe(true);
    expect(partyConditionUpdateInputSchema.safeParse({ action: "set", party: { kind: "composition", adults: 2, children: 1 }, quote: "大人2人と子ども1人" }).success).toBe(true);
    expect(partyConditionUpdateInputSchema.safeParse({ action: "set", party: { kind: "composition", adults: 0, children: 0 }, quote: "0人" }).success).toBe(false);
    expect(partyConditionUpdateInputSchema.safeParse({ action: "set", party: { kind: "composition", adults: 21, children: 0 }, quote: "21人" }).success).toBe(false);

    let overlay = empty();
    const count = admitConditionChange({ target: "party_size", party: { kind: "count", people: 2 }, quote: "2人で" }, "2人で行きたい");
    overlay = reduceConversationIntent(overlay, conditionDelta(count, "72700000-0000-4000-8000-000000000001", overlay)).overlay;
    expect(overlay.facts[0]?.value).toEqual({ kind: "quantity", amount: 2, unit: "people" });

    const detailed = admitConditionChange({ target: "party_size",
      party: { kind: "composition", adults: 2, children: 1 }, quote: "大人2人と子ども1人" },
      "大人2人と子ども1人で行く");
    overlay = reduceConversationIntent(overlay, conditionDelta(detailed, "72700000-0000-4000-8000-000000000002", overlay)).overlay;
    expect(overlay.facts[0]?.value).toEqual({ kind: "party", adults: 2, children: [{}] });

    const cleared = admitConditionChange({ target: "party_size", party: null, quote: "人数は未定に戻して" }, "人数は未定に戻して");
    overlay = reduceConversationIntent(overlay, conditionDelta(cleared, "72700000-0000-4000-8000-000000000003", overlay)).overlay;
    expect(overlay.facts).toHaveLength(0);
    expect(overlay.tombstones).toContainEqual(expect.objectContaining({ target: "party_size" }));
  });
  it("admits hypothetical party and period values only as non-persistent scenario inputs", () => {
    expect(tripScenarioInputSchema.safeParse({ kind: "party", party: { kind: "count", people: 4 }, quote: "もし4人なら" }).success).toBe(true);
    expect(admitTripScenario({ kind: "party", party: { kind: "count", people: 4 }, quote: "もし4人なら" },
      "もし4人ならどうなる？今の人数は変えずに比較したい")).toEqual({
        kind: "party", party: { kind: "count", people: 4 }, quote: "もし4人なら",
      });
    expect(admitTripScenario({ kind: "travel_period", period: { duration: { amount: 7, unit: "days" } }, quote: "もし1週間なら" },
      "もし1週間ならどう？")).toEqual({
        kind: "travel_period", period: { duration: { amount: 7, unit: "days" } }, quote: "もし1週間なら",
      });
    expect(() => admitTripScenario({ kind: "party", party: { kind: "count", people: 4 }, quote: "別の発言" },
      "もし4人ならどうなる？")).toThrow("invalid_source");
  });

  it("accepts one atomic travel-period slot with multiple Domain targets and resolves calendar expressions in Application", () => {
    expect(travelPeriodUpdateInputSchema.safeParse({ action: "set", period: {
      start: { kind: "calendar_date", month: 10, day: 3 },
      end: { kind: "calendar_date", day: 5 },
    }, quote: "10月3日から5日まで" }).success).toBe(true);
    const accepted = admitConditionChange({ target: "travel_period", period: {
      start: { kind: "calendar_date", month: 10, day: 3 },
      end: { kind: "calendar_date", day: 5 },
    }, quote: "10月3日から5日まで" }, "10月3日から5日まで旅行します", "2026-09-27");
    expect(accepted).toEqual({ target: "travel_period", period: {
      start: { kind: "local_date", date: "2026-10-03", anchorDate: "2026-09-27", resolverVersion: "calendar-v1" },
      end: { kind: "local_date", date: "2026-10-05", anchorDate: "2026-09-27", resolverVersion: "calendar-v1" },
    }, quote: "10月3日から5日まで" });
    const reduction = reduceConversationIntent(empty(), conditionDelta(accepted, "73000000-0000-4000-8000-000000000001", empty()));
    expect(reduction.receipt.intentRevision).toBe(1);
    expect(reduction.receipt.operations).toHaveLength(3);
    expect(new Set(reduction.receipt.operations.map(({ groupId }) => groupId)).size).toBe(1);
    expect(reduction.receipt.operations.every(({ status }) => status === "accepted")).toBe(true);
    expect(reduction.overlay.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: "start_date", value: expect.objectContaining({ kind: "local_date", date: "2026-10-03" }) }),
      expect.objectContaining({ target: "end_date", value: expect.objectContaining({ kind: "local_date", date: "2026-10-05" }) }),
    ]));
    expect(reduction.overlay.facts.some(({ target }) => target === "duration")).toBe(false);
    expect(reduction.overlay.tombstones).toContainEqual(expect.objectContaining({ target: "duration" }));
  });

  it("keeps duration explicit, resolves trusted relative dates, and rejects inferred or inconsistent periods", () => {
    const duration = admitConditionChange({ target: "travel_period", period: {
      duration: { amount: 3, unit: "nights" },
    }, quote: "3泊" }, "3泊で行きたい", "2026-09-27");
    expect(duration).toEqual({ target: "travel_period", period: { duration: { amount: 3, unit: "nights" } }, quote: "3泊" });
    const relative = admitConditionChange({ target: "travel_period", period: {
      start: { kind: "relative_date", relation: "tomorrow" },
      duration: { amount: 2, unit: "days" },
    }, quote: "明日から2日間" }, "明日から2日間で行きたい", "2026-09-27");
    expect(relative).toEqual({ target: "travel_period", period: {
      start: { kind: "local_date", date: "2026-09-28", expression: "tomorrow", anchorDate: "2026-09-27", resolverVersion: "calendar-v1" },
      duration: { amount: 2, unit: "days" },
    }, quote: "明日から2日間" });
    expect(() => admitConditionChange({ target: "travel_period", period: {
      start: { kind: "relative_date", relation: "tomorrow" },
    }, quote: "明日" }, "明日から", undefined)).toThrow("invalid_condition");
    expect(() => admitConditionChange({ target: "travel_period", period: {
      start: { kind: "calendar_date", year: 2026, month: 10, day: 5 },
      end: { kind: "calendar_date", year: 2026, month: 10, day: 3 },
    }, quote: "2026-10-05から2026-10-03" }, "2026-10-05から2026-10-03", "2026-09-27")).toThrow("invalid_condition");
    expect(() => admitConditionChange({ target: "travel_period", period: {
      start: { kind: "calendar_date", year: 2026, month: 10, day: 3 },
      end: { kind: "calendar_date", year: 2026, month: 10, day: 5 },
      duration: { amount: 4, unit: "nights" },
    }, quote: "2026-10-03から2026-10-05まで4泊" }, "2026-10-03から2026-10-05まで4泊", "2026-09-27")).toThrow("invalid_condition");
  });

  it("maps a yearless month/day to its first occurrence on or after the trusted calendar date", () => {
    const christmas = admitConditionChange({ target: "travel_period", period: {
      start: { kind: "calendar_date", month: 12, day: 25 },
    }, quote: "12/25" }, "12/25に出発", "2026-09-26");
    expect(christmas).toEqual({ target: "travel_period", period: {
      start: { kind: "local_date", date: "2026-12-25", anchorDate: "2026-09-26", resolverVersion: "calendar-v1" },
    }, quote: "12/25" });

    const january = admitConditionChange({ target: "travel_period", period: {
      start: { kind: "calendar_date", month: 1, day: 21 },
    }, quote: "1/21" }, "1/21に出発", "2026-09-26");
    expect(january).toEqual({ target: "travel_period", period: {
      start: { kind: "local_date", date: "2027-01-21", anchorDate: "2026-09-26", resolverVersion: "calendar-v1" },
    }, quote: "1/21" });

    const explicitYear = admitConditionChange({ target: "travel_period", period: {
      start: { kind: "calendar_date", year: 2028, month: 1, day: 21 },
    }, quote: "2028年1月21日" }, "2028年1月21日に出発", "2026-09-26");
    expect(explicitYear).toEqual({ target: "travel_period", period: {
      start: { kind: "local_date", date: "2028-01-21" },
    }, quote: "2028年1月21日" });
  });

  it("identifies a final condition decision independently of SDK call order and quote selection", () => {
    const a = admitConditionChange({ target: "destination", place: "京都", quote: "京都" }, "京都に行きたい");
    const b = admitConditionChange({ target: "destination", place: "京都", quote: "京都に行きたい" }, "京都に行きたい");
    expect(conditionPayload(a)).toBe(conditionPayload(b));
    expect(conditionOperationId(turn, a.target)).not.toBe(conditionOperationId(turn, "origin"));
    expect(conditionOperationId(turn, a.target)).not.toBe(conditionOperationId("71600000-0000-4000-8000-000000000002", a.target));

  });
});
