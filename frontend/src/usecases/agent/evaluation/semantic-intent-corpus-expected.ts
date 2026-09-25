import type { SemanticIntentCaseExpected, ExpectedSemanticOperation } from "./semantic-intent-evaluation";

const family = (category: string, operations: readonly ExpectedSemanticOperation[], speechAct: SemanticIntentCaseExpected["allowed"][number]["speechAct"] = "inform",
  forbiddenTargets: SemanticIntentCaseExpected["forbiddenTargets"] = []): SemanticIntentCaseExpected[] => operations.map((operation, index) => ({
    caseId: `${category}-${String(index + 1).padStart(2, "0")}`,
    allowed: [{ outcome: "delta", speechAct, operations: [operation] }], forbiddenTargets: [...forbiddenTargets],
  }));
const op = (target: ExpectedSemanticOperation["target"], value: Record<string, unknown> | undefined,
  extra: Partial<ExpectedSemanticOperation> = {}): ExpectedSemanticOperation => ({ target, action: "set", frame: "actual", ...(value ? { value } : {}), ...extra });
const place = (target: "origin" | "destination", label: string) => op(target, { kind: "place_label", label }, { modality: "preferred", precision: "exact" });
const noChange = (category: string, count: number): SemanticIntentCaseExpected[] => Array.from({ length: count }, (_, index) => ({
  caseId: `${category}-${String(index + 1).padStart(2, "0")}`, allowed: [{ outcome: "no_change", speechAct: "question", operations: [] }],
  forbiddenTargets: ["goal", "origin", "destination", "start_date", "end_date", "duration", "party_size", "budget", "experience", "pace", "accommodation", "transport", "fixed_schedule", "candidate_selection"],
}));

/** Gold is physically separated from utterances. Runners join only after a
 * model result exists and assert that case IDs are complete and unique. */
const baseSemanticIntentCorpusExpected: SemanticIntentCaseExpected[] = [
  ...family("destination", ["出雲大社", "金沢", "松江", "倉敷", "高山", "長崎", "奈良", "富山", "仙台", "広島"].map((value) => place("destination", value))),
  ...family("origin", ["大阪", "京都", "東京", "博多駅", "名古屋", "札幌", "神戸", "横浜", "大宮", "広島駅"].map((value) => place("origin", value))),
  ...family("duration", [
    op("duration", { kind: "quantity", amount: 2, unit: "nights" }, { modality: "preferred", precision: "approximate" }),
    op("duration", { kind: "quantity", amount: 3, unit: "nights" }, { precision: "exact" }),
    op("duration", { kind: "quantity", amount: 0, unit: "nights" }, { precision: "exact" }),
    op("duration", { kind: "quantity", amount: 4, unit: "days" }, { precision: "exact" }),
    op("duration", { kind: "quantity_range", minimum: 1, maximum: 2, unit: "nights" }, { precision: "range" }),
    op("duration", { kind: "quantity", amount: 5, unit: "nights" }, { modality: "required", precision: "exact" }),
    op("duration", { kind: "quantity", amount: 3, unit: "nights" }, { precision: "exact" }),
    op("duration", { kind: "quantity", amount: 2, unit: "days" }, { precision: "approximate" }),
    op("duration", { kind: "quantity", amount: 6, unit: "nights" }, { precision: "exact" }),
    op("duration", { kind: "quantity", amount: 0, unit: "nights" }, { precision: "exact" }),
  ]),
  ...family("modality", [
    op("experience", { kind: "text", text: "温泉" }, { modality: "required", precision: "qualitative" }),
    op("experience", { kind: "text", text: "温泉" }, { modality: "preferred", precision: "qualitative" }),
    op("experience", { kind: "text", text: "温泉" }, { modality: "acceptable", precision: "qualitative" }),
    op("experience", { kind: "text", text: "温泉" }, { modality: "avoid", precision: "qualitative" }),
    op("experience", { kind: "text", text: "温泉" }, { modality: "forbidden", precision: "qualitative" }),
    op("experience", { kind: "text", text: "食事" }, { modality: "required", precision: "qualitative" }),
    op("experience", { kind: "text", text: "美術館" }, { modality: "preferred", precision: "qualitative" }),
    op("experience", { kind: "text", text: "自然" }, { modality: "acceptable", precision: "qualitative" }),
    op("experience", { kind: "text", text: "混雑" }, { modality: "avoid", precision: "qualitative" }),
    op("fixed_schedule", { kind: "text", text: "早朝出発" }, { modality: "forbidden", precision: "qualitative" }),
  ]),
  ...family("retract", ["destination", "origin", "budget", "experience", "start_date", "party_size", "duration", "transport", "pace", "candidate_selection"].map((target, index) =>
    op(target as ExpectedSemanticOperation["target"], undefined, { action: "retract", frame: "actual",
      ...(index === 7 ? { scope: { kind: "segment_direction", direction: "return" as const } } : {}),
      ...(index === 8 ? { scope: { kind: "logical_day_ordinal", ordinal: 2 } } : {}) })), "cancel"),
  ...family("hypothetical", ["experience", "duration", "origin", "party_size", "budget", "transport", "pace", "experience", "start_date", "party_size"].map((target, index) =>
    op(target as ExpectedSemanticOperation["target"], undefined, { frame: "hypothetical", ...(index === 5 ? { scope: { kind: "segment_direction", direction: "return" as const } } : {}),
      ...(index === 6 ? { scope: { kind: "logical_day_ordinal", ordinal: 2 } } : {}) })), "consider"),
  ...noChange("question", 10),
  ...family("relative-date", [
    op("start_date", { kind: "relative_date", relation: "tomorrow" }, { precision: "exact" }),
    op("start_date", { kind: "relative_date", relation: "day_after_tomorrow" }, { precision: "exact" }),
    op("start_date", { kind: "relative_date", relation: "today" }, { precision: "exact" }),
    op("start_date", { kind: "relative_weekday", weekday: 1, direction: "next" }, { precision: "exact" }),
    op("start_date", { kind: "month_offset", offset: 1 }, { precision: "qualitative" }),
    op("start_date", { kind: "relative_date", relation: "tomorrow" }, { precision: "exact" }),
    op("end_date", { kind: "relative_date", relation: "day_after_tomorrow" }, { precision: "exact" }),
    op("start_date", { kind: "relative_weekday", weekday: 5, direction: "next" }, { precision: "exact" }),
    op("start_date", { kind: "month_offset", offset: 2 }, { precision: "qualitative" }),
    op("start_date", { kind: "relative_date", relation: "tomorrow" }, { action: "replace", precision: "exact" }),
  ]),
  ...family("day-scope", [
    ["pace", "活発"], ["pace", "のんびり"], ["experience", "食事"], ["transport", "歩行を少なめ"], ["experience", "温泉なし"],
    ["fixed_schedule", "早朝出発"], ["experience", "美術館"], ["budget", "予算を抑える"], ["transport", "バスを避ける"], ["pace", "自由時間多め"],
  ].map(([target, text], index) => op(target as ExpectedSemanticOperation["target"], { kind: "text", text }, { precision: "qualitative",
    scope: { kind: "logical_day_ordinal", ordinal: [2, 1, 3, 4, 2, 5, 1, 3, 2, 10][index]! } }))),
  ...family("budget", [
    op("budget", { kind: "money", amount: 50_000, currency: "JPY", basis: "per_person" }, { precision: "range" }),
    op("budget", { kind: "money", amount: 100_000, currency: "JPY", basis: "trip" }, { precision: "exact" }),
    op("budget", { kind: "money", amount: 20_000, currency: "JPY", basis: "per_night" }, { precision: "approximate" }),
    op("budget", { kind: "money", amount: 30_000, currency: "JPY", basis: "per_room" }, { precision: "range" }),
    op("budget", { kind: "money", amount: 80_000, currency: "JPY" }, { precision: "approximate" }),
    op("budget", { kind: "money", amount: 40_000, currency: "JPY", basis: "per_person" }, { precision: "exact" }),
    op("budget", { kind: "money", amount: 120_000, currency: "JPY", basis: "trip" }, { precision: "range" }),
    op("budget", { kind: "money", amount: 15_000, currency: "JPY", basis: "per_night" }, { precision: "approximate" }),
    op("budget", { kind: "money", amount: 10_000, currency: "JPY", basis: "per_person" }, { precision: "exact" }),
    op("budget", { kind: "unknown", reason: "undecided" }, { precision: "qualitative" }),
  ]),
  ...family("alternative", [
    place("destination", "金沢"), op("experience", { kind: "text", text: "食事重視" }), op("experience", { kind: "text", text: "温泉" }, { modality: "acceptable" }),
    op("duration", { kind: "quantity", amount: 3, unit: "nights" }, { modality: "acceptable" }), op("transport", { kind: "text", text: "飛行機" }),
    place("destination", "奈良か京都"), op("pace", { kind: "text", text: "活発" }), op("transport", { kind: "text", text: "新幹線" }, { modality: "acceptable", scope: { kind: "segment_direction", direction: "return" } }),
    op("experience", { kind: "text", text: "自然" }), op("accommodation", { kind: "text", text: "旅館" }),
  ].map((value) => ({ ...value, action: "add_alternative" })), "consider"),
  ...family("unknown", ["destination", "origin", "start_date", "party_size", "budget", "accommodation", "transport", "duration", "experience", "party_size"].map((target, index) =>
    op(target as ExpectedSemanticOperation["target"], { kind: "unknown", reason: ["unknown_to_user", "undecided", "undecided", "unknown_to_user", "withheld", "no_preference", "no_preference", "unspecified", "no_preference", "unknown_to_user"][index]! },
      { precision: "qualitative" }))),
];

export const semanticIntentCorpusExpected: SemanticIntentCaseExpected[] = baseSemanticIntentCorpusExpected.map((item) => {
  if (item.caseId === "retract-04") return { ...item, allowed: [...item.allowed, { outcome: "delta", speechAct: "reject", operations: [
    op("experience", { kind: "text", text: "温泉" }, { modality: "avoid", precision: "qualitative" }),
  ] }] };
  if (item.caseId === "relative-date-06") return { ...item, allowed: [{ outcome: "delta", speechAct: "inform", operations: [
    op("start_date", { kind: "relative_date", relation: "tomorrow" }, { precision: "exact" }),
    op("duration", { kind: "quantity", amount: 2, unit: "nights" }, { precision: "exact" }),
  ] }] };
  if (item.caseId === "budget-07") return { ...item, allowed: [{ outcome: "delta", speechAct: "inform", operations: [
    op("party_size", { kind: "quantity", amount: 2, unit: "people" }, { precision: "exact" }),
    op("budget", { kind: "money", amount: 120_000, currency: "JPY", basis: "trip" }, { precision: "range" }),
  ] }] };
  if (item.caseId === "alternative-06") return { ...item, allowed: [{ outcome: "delta", speechAct: "consider", operations: [
    { ...place("destination", "奈良"), action: "add_alternative" }, { ...place("destination", "京都"), action: "add_alternative" },
  ] }] };
  return item;
});
