import { describe, expect, it } from "vitest";
import { z } from "zod";
import { admitConditionChange, admitTripScenario, completeConditionFromCurrentIntent, budgetConditionUpdateInputSchema, conditionDelta, conditionOperationId, conditionPayload, placeConditionUpdateInputSchema, partyConditionUpdateInputSchema, travelPeriodUpdateInputSchema, tripScenarioInputSchema } from "./conversation-condition";
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

  it("keeps duration explicit, resolves trusted dates and derives an internally consistent end", () => {
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
      end: { kind: "local_date", date: "2026-09-29" },
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

  it("retains an explicit day trip together with its trusted relative start in one period receipt", () => {
    const change = admitConditionChange({ target: "travel_period", period: {
      start: { kind: "relative_date", relation: "tomorrow" }, duration: { amount: 1, unit: "days" },
    }, quote: "明日日帰り" }, "明日日帰りで城崎温泉にいきたい", "2026-10-11");
    expect(change).toMatchObject({ period: { start: { date: "2026-10-12" }, duration: { amount: 1, unit: "days" } } });
    expect(change).toHaveProperty("period.end", { kind: "local_date", date: "2026-10-12" });
    const reduced = reduceConversationIntent(empty(), conditionDelta(change, "73000000-0000-4000-8000-000000000010", empty()));
    expect(reduced.overlay.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: "start_date", value: expect.objectContaining({ date: "2026-10-12" }) }),
      expect.objectContaining({ target: "duration", value: { kind: "quantity", amount: 1, unit: "days" } }),
    ]));
    expect(new Set(reduced.receipt.operations.map(operation => operation.groupId)).size).toBe(1);
    expect(() => admitConditionChange({ target: "travel_period", period: { duration: { amount: 2, unit: "days" } },
      quote: "日帰り" }, "日帰り")).toThrow("invalid_source");
    expect(() => admitConditionChange({ target: "travel_period", period: { duration: { amount: 1, unit: "nights" } },
      quote: "日帰り" }, "日帰り")).toThrow("invalid_source");
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

  it("grounds budget amount, currency and basis without promoting guessed optional fields", () => {
    expect(budgetConditionUpdateInputSchema.safeParse({ action: "set",
      budget: { amount: 100000, currency: "JPY", basis: "trip" }, quote: "全部で10万円まで" }).success).toBe(true);
    const total = admitConditionChange({ target: "budget",
      budget: { amount: 100000, currency: "JPY", basis: "trip" }, quote: "全部で10万円まで" },
      "全部で10万円までにしたい");
    expect(total).toEqual({ target: "budget", budget: { amount: 100000, currency: "JPY", basis: "trip" }, quote: "全部で10万円まで" });

    const perPerson = admitConditionChange({ target: "budget",
      budget: { amount: 50000, currency: "JPY", basis: "per_person" }, quote: "1人5万円くらい" },
      "予算は1人5万円くらい");
    expect(perPerson).toEqual({ target: "budget", budget: { amount: 50000, currency: "JPY", basis: "per_person" }, quote: "1人5万円くらい" });
    const reduced = reduceConversationIntent(empty(), conditionDelta(perPerson, "73200000-0000-4000-8000-000000000001", empty()));
    expect(reduced.overlay.facts[0]).toMatchObject({ target: "budget", precision: "approximate",
      value: { kind: "money", amount: 50000, currency: "JPY", basis: "per_person" } });

    const euro = admitConditionChange({ target: "budget",
      budget: { amount: 500, currency: "EUR", basis: "trip" }, quote: "500ユーロ" }, "予算は500ユーロ");
    expect(euro).toEqual({ target: "budget", budget: { amount: 500, currency: "EUR" }, quote: "500ユーロ" });

    const currencyUnknown = admitConditionChange({ target: "budget",
      budget: { amount: 50000, currency: "JPY", basis: "trip" }, quote: "5万くらい" }, "予算は5万くらい");
    expect(currencyUnknown).toEqual({ target: "budget", budget: { amount: 50000 }, quote: "5万くらい" });
    expect(() => admitConditionChange({ target: "budget",
      budget: { amount: 60000, currency: "JPY" }, quote: "5万円" }, "予算は5万円")).toThrow("invalid_source");
  });

  it("retracts only the current budget and keeps budget what-if non-persistent", () => {
    let overlay = empty();
    const set = admitConditionChange({ target: "budget",
      budget: { amount: 100000, currency: "JPY", basis: "trip" }, quote: "全部で10万円" }, "全部で10万円");
    overlay = reduceConversationIntent(overlay, conditionDelta(set, "73200000-0000-4000-8000-000000000002", overlay)).overlay;
    expect(overlay.facts[0]?.value).toEqual({ kind: "money", amount: 100000, currency: "JPY", basis: "trip" });

    expect(admitTripScenario({ kind: "budget", budget: { amount: 200000, currency: "JPY", basis: "trip" }, quote: "もし20万円なら" },
      "もし20万円ならどう？")).toEqual({ kind: "budget", budget: { amount: 200000, currency: "JPY" }, quote: "もし20万円なら" });
    expect(overlay.intentRevision).toBe(1);

    const cleared = admitConditionChange({ target: "budget", budget: null, quote: "予算は未定に戻して" }, "予算は未定に戻して");
    overlay = reduceConversationIntent(overlay, conditionDelta(cleared, "73200000-0000-4000-8000-000000000003", overlay)).overlay;
    expect(overlay.facts).toHaveLength(0);
    expect(overlay.tombstones).toContainEqual(expect.objectContaining({ target: "budget" }));
  });

  it("identifies a final condition decision independently of SDK call order and quote selection", () => {
    const a = admitConditionChange({ target: "destination", place: "京都", quote: "京都" }, "京都に行きたい");
    const b = admitConditionChange({ target: "destination", place: "京都", quote: "京都に行きたい" }, "京都に行きたい");
    expect(conditionPayload(a)).toBe(conditionPayload(b));
    expect(conditionOperationId(turn, a.target)).not.toBe(conditionOperationId(turn, "origin"));
    expect(conditionOperationId(turn, a.target)).not.toBe(conditionOperationId("71600000-0000-4000-8000-000000000002", a.target));

  });
});


it.each([
  ["2026-10-11", "next", 6, "来週の土曜日", "2026-10-17"],
  ["2026-10-12", "next", 6, "来週土曜", "2026-10-24"],
  ["2026-10-17", "this", 6, "今週の土曜日", "2026-10-17"],
  ["2026-12-27", "after_next", 1, "再来週の月曜日", "2027-01-04"],
  ["2026-10-11", "next", 7, "来週の日曜日", "2026-10-18"],
])("resolves %s / %s weekday %s from the trusted Monday-start calendar", (anchor, week, weekday, quote, expected) => {
  const change = admitConditionChange({ target: "travel_period", period: { start: { kind: "relative_weekday", week, weekday } }, quote }, quote, anchor);
  expect(change).toMatchObject({ period: { start: { date: expected, expression: "relative_weekday", anchorDate: anchor, resolverVersion: "calendar-v1" } } });
});

it("rejects invented weekday dates and mismatched week/weekday claims", () => {
  const quote = "来週の土曜日";
  for (const start of [{ kind: "calendar_date", month: 10, day: 17 },
    { kind: "relative_weekday", week: "next", weekday: 5 }, { kind: "relative_weekday", week: "after_next", weekday: 6 }]) {
    expect(() => admitConditionChange({ target: "travel_period", period: { start }, quote }, quote, "2026-10-11")).toThrow("invalid_source");
  }
  expect(() => admitConditionChange({ target: "travel_period", period: { start: { kind: "relative_weekday", week: "next", weekday: 6 } }, quote }, quote)).toThrow("invalid_condition");
});

it.each([
  ["10/12から1泊2日", 1, "nights", "2026-10-13"],
  ["10/12から一泊二日", 1, "nights", "2026-10-13"],
  ["10/12から1泊2日", 2, "days", "2026-10-13"],
  ["10/12の日帰り", 1, "days", "2026-10-12"],
  ["10/12から2泊3日", 2, "nights", "2026-10-14"],
])("derives the end of %s without a model-authored return date", (quote, amount, unit, expected) => {
  const change = admitConditionChange({ target: "travel_period", period: { start: { kind: "calendar_date", month: 10, day: 12 }, duration: { amount, unit } }, quote }, quote, "2026-10-11");
  expect(change).toHaveProperty("period.end", { kind: "local_date", date: expected });
});

it("crosses month/year/leap-day boundaries and rejects contradictory stay counters", () => {
  for (const [quote, year, month, day, expected] of [["2026年12月31日から1泊2日", 2026, 12, 31, "2027-01-01"], ["2028年2月28日から1泊2日", 2028, 2, 28, "2028-02-29"]] as const) {
    const change = admitConditionChange({ target: "travel_period", period: { start: { kind: "calendar_date", year, month, day }, duration: { amount: 1, unit: "nights" } }, quote }, quote);
    expect(change).toHaveProperty("period.end.date", expected);
  }
  for (const quote of ["10/12から1泊3日", "10/12から一泊三日"]) {
    expect(() => admitConditionChange({ target: "travel_period", period: { start: { kind: "calendar_date", month: 10, day: 12 }, duration: { amount: 1, unit: "nights" } }, quote }, quote, "2026-10-11")).toThrow("invalid_condition");
  }
  expect(() => admitConditionChange({ target: "travel_period", period: { duration: { amount: 1, unit: "nights" } }, quote: "11泊" }, "11泊")).toThrow("invalid_source");
});

it.each([false, true])("combines accepted start and duration across turns (duration first: %s) and recalculates corrections", durationFirst => {
  const start = admitConditionChange({ target: "travel_period", period: { start: { kind: "calendar_date", month: 10, day: 12 } }, quote: "10/12" }, "10/12", "2026-10-11");
  const duration = admitConditionChange({ target: "travel_period", period: { duration: { amount: 1, unit: "nights" } }, quote: "1泊2日" }, "1泊2日");
  let overlay = empty();
  for (const [index, change] of (durationFirst ? [duration, start] : [start, duration]).entries()) {
    overlay = reduceConversationIntent(overlay, conditionDelta(change, `turn-${index}`, overlay)).overlay;
  }
  const get = (target: string) => overlay.facts.find(fact => fact.target === target)!;
  expect(get("start_date").value).toMatchObject({ date: "2026-10-12" });
  expect(get("end_date").value).toMatchObject({ date: "2026-10-13" });
  expect(get("duration").value).toMatchObject({ amount: 1, unit: "nights" });
  expect(get(durationFirst ? "duration" : "start_date").provenance.turnId).toBe("turn-0");
  const corrected = admitConditionChange({ target: "travel_period", period: { start: { kind: "calendar_date", month: 10, day: 17 } }, quote: "10/17" }, "10/17", "2026-10-11");
  overlay = reduceConversationIntent(overlay, conditionDelta(corrected, "turn-correction", overlay)).overlay;
  expect(get("end_date").value).toMatchObject({ date: "2026-10-18" });
  const dayTrip = admitConditionChange({ target: "travel_period", period: { duration: { amount: 1, unit: "days" } }, quote: "日帰り" }, "日帰り");
  overlay = reduceConversationIntent(overlay, conditionDelta(dayTrip, "turn-daytrip", overlay)).overlay;
  expect(get("end_date").value).toMatchObject({ date: "2026-10-17" });
  overlay = reduceConversationIntent(overlay, conditionDelta({ target: "travel_period", period: null, quote: "日程を未定に" }, "turn-clear", overlay)).overlay;
  overlay = reduceConversationIntent(overlay, conditionDelta(duration, "turn-after-clear", overlay)).overlay;
  expect(overlay.facts.filter(fact => fact.value.kind === "local_date")).toEqual([]);
});


it.each(["user", "profile", "legacy", "assumption"] as const)("supplements dates only from exact persisted user conditions, source=%s", source => {
  const current = compileEffectiveIntent({ overlay: empty(), baseRequest: { assumptions: [], constraints: [{ id: "dates", source, strength: "soft", scope: { type: "trip" },
    requirement: { type: "dates", start: { earliest: "2026-10-12", latest: "2026-10-12" } } }] }, baseSource: "trip" });
  const change = admitConditionChange({ target: "travel_period", period: { duration: { amount: 1, unit: "nights" } }, quote: "1泊2日" }, "1泊2日");
  const completed = completeConditionFromCurrentIntent(change, current);
  if (source === "user") expect(completed).toHaveProperty("period.end.date", "2026-10-13");
  else expect(completed).not.toHaveProperty("period.end");
});

it("does not derive a fixed end from a date window or a hypothetical duration", () => {
  const current = compileEffectiveIntent({ overlay: empty(), baseRequest: { assumptions: [], constraints: [{ id: "dates", source: "user", strength: "soft", scope: { type: "trip" },
    requirement: { type: "dates", start: { earliest: "2026-10-12", latest: "2026-10-14" } } }] }, baseSource: "trip" });
  const change = admitConditionChange({ target: "travel_period", period: { duration: { amount: 1, unit: "nights" } }, quote: "1泊2日" }, "1泊2日");
  expect(completeConditionFromCurrentIntent(change, current)).not.toHaveProperty("period.end");
  const duration = admitConditionChange({ target: "travel_period", period: { duration: { amount: 1, unit: "nights" } }, quote: "1泊" }, "1泊");
  const hypothetical = conditionDelta(duration, "scenario", empty()); hypothetical.operations.forEach(operation => operation.frame = "hypothetical");
  const overlay = reduceConversationIntent(empty(), hypothetical).overlay;
  const start = admitConditionChange({ target: "travel_period", period: { start: { kind: "calendar_date", month: 10, day: 12 } }, quote: "10/12" }, "10/12", "2026-10-11");
  expect(reduceConversationIntent(overlay, conditionDelta(start, "actual-start", overlay)).overlay.facts.find(fact => fact.target === "end_date" && fact.frame === "actual")).toBeUndefined();
});
