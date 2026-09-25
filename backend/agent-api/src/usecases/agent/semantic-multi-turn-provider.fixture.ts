import type { UtteranceInterpretation } from "@raiquora/agent/semantic-interpretation";

type Operation = UtteranceInterpretation["operations"][number];
const operation = (quote: string, target: Operation["target"], value: Operation["value"], extra: Partial<Operation> = {}): Operation => ({
  atomicGroup: 1, action: "set", target, modality: "preferred", precision: "qualitative", frame: "actual", quote,
  ...(value === undefined ? {} : { value }), ...extra,
});
const delta = (speechAct: UtteranceInterpretation["speechAct"], operations: Operation[]): UtteranceInterpretation =>
  ({ outcome: "delta", speechAct, operations, unresolvedFragments: [] });
const provider = new Map<string, UtteranceInterpretation>();
const register = (utterance: string, interpretation: UtteranceInterpretation) => provider.set(utterance, interpretation);

for (const [first, second] of [["金沢", "富山"], ["松江", "倉敷"], ["奈良", "京都"], ["仙台", "山形"], ["長崎", "佐賀"]]) {
  register(`${first}に行きたい`, delta("inform", [operation(first, "destination", { kind: "place_label", label: first }, { precision: "exact" })]));
  register(`やっぱり${second}に変更`, delta("correct", [operation(second, "destination", { kind: "place_label", label: second }, { action: "replace", precision: "exact" })]));
}
for (const [first, second] of [["歴史", "食事"], ["自然", "温泉"], ["美術館", "建築"], ["鉄道", "市場"], ["庭園", "喫茶店"]]) {
  register(`${first}を重視`, delta("inform", [operation(first, "experience", { kind: "text", text: first })]));
  register(`${second}も追加して`, delta("inform", [operation(second, "experience", { kind: "text", text: second }, { action: "add_alternative" })]));
}
const scopedPaces = [["のんびり", "活発", 2, "2日目だけ活発に"], ["活発", "ゆったり", 3, "3日目だけゆったり"],
  ["標準ペース", "のんびり", 1, "1日目だけのんびり"], ["ゆったり", "活発", 4, "4日目だけ活発に"],
  ["軽め", "多めに歩く", 5, "5日目だけ多めに歩く"]] as const;
for (const [first, second, ordinal, utterance] of scopedPaces) {
  register(`全体は${first}`, delta("inform", [operation(first, "pace", { kind: "text", text: first })]));
  register(utterance, delta("correct", [operation(`${ordinal}日目だけ${second}`, "pace", { kind: "text", text: second },
    { scope: { kind: "logical_day_ordinal", ordinal } })]));
}
const origins = [["大阪", "出発地はいったん未定に戻す"], ["京都", "起点はまだ決めない"], ["東京", "出発場所の指定を取り下げる"],
  ["名古屋", "どこから出るかは保留"], ["博多駅", "出発地の条件を消して"]] as const;
for (const [origin, retract] of origins) {
  register(`${origin}から出発`, delta("inform", [operation(origin, "origin", { kind: "place_label", label: origin }, { precision: "exact" })]));
  register(retract, delta("cancel", [operation(retract, "origin", undefined, { action: "retract" })]));
}
const hypotheticals: ReadonlyArray<readonly [string, string, Operation["target"], Operation["value"], Operation["value"]]> = [
  ["一人旅です", "もし二人ならどうなる？", "party_size", { kind: "quantity", amount: 1, unit: "people" }, { kind: "quantity", amount: 2, unit: "people" }],
  ["2泊にします", "仮に3泊ならどうなる？", "duration", { kind: "quantity", amount: 2, unit: "nights" }, { kind: "quantity", amount: 3, unit: "nights" }],
  ["予算は5万円", "もし8万円ならどうなる？", "budget", { kind: "money", amount: 50_000, currency: "JPY", basis: "trip" }, { kind: "money", amount: 80_000, currency: "JPY", basis: "trip" }],
  ["移動は新幹線", "仮に飛行機ならどうなる？", "transport", { kind: "text", text: "新幹線" }, { kind: "text", text: "飛行機" }],
  ["宿はホテル", "もし旅館ならどうなる？", "accommodation", { kind: "text", text: "ホテル" }, { kind: "text", text: "旅館" }],
];
for (const [actual, hypothetical, target, actualValue, hypotheticalValue] of hypotheticals) {
  const exact = target === "party_size" || target === "duration" || target === "budget";
  register(actual, delta("inform", [operation(actual, target, actualValue, { precision: exact ? "exact" : "qualitative" })]));
  register(hypothetical, delta("consider", [operation(hypothetical.replace(/[？?]/gu, ""), target, hypotheticalValue,
    { frame: "hypothetical", precision: exact ? "exact" : "qualitative" })]));
}
for (const [destination, question] of [["出雲大社", "この地域の特徴は？"], ["高山", "一般に旅行保険は必要？"], ["広島", "新幹線と飛行機はどう違う？"],
  ["札幌", "予約はいつ取るべき？"], ["神戸", "今の条件を確認したい"]]) {
  register(`${destination}に行きたい`, delta("inform", [operation(destination, "destination", { kind: "place_label", label: destination }, { precision: "exact" })]));
  register(question, { outcome: "no_change", speechAct: "question", operations: [], unresolvedFragments: [] });
}
const modalities: ReadonlyArray<readonly [string, string, Operation["target"], string, Operation["modality"]]> = [
  ["温泉は必須", "温泉は必須でなくてもよい", "experience", "温泉", "required"],
  ["美術館を優先したい", "美術館は候補程度でよい", "experience", "美術館", "preferred"],
  ["早朝出発は絶対なし", "早朝出発は避ける程度にする", "fixed_schedule", "早朝出発", "forbidden"],
];
for (const [first, second, target, text, modality] of modalities) {
  register(first, delta("inform", [operation(text, target, { kind: "text", text }, { modality })]));
  register(second, delta("correct", [operation(text, target, undefined, { action: "relax" })]));
}
const dates: ReadonlyArray<readonly [string, Operation["value"], string, Operation["value"]]> = [
  ["明日出発", { kind: "relative_date", relation: "tomorrow" }, "あさって出発へ変更", { kind: "relative_date", relation: "day_after_tomorrow" }],
  ["あさって出発", { kind: "relative_date", relation: "day_after_tomorrow" }, "次の月曜へ変更", { kind: "relative_weekday", weekday: 1, direction: "next" }],
  ["今日出発", { kind: "relative_date", relation: "today" }, "来月出発へ変更", { kind: "month_offset", offset: 1 }],
];
for (const [first, firstValue, second, secondValue] of dates) {
  register(first, delta("inform", [operation(first.replace(/出発/gu, ""), "start_date", firstValue, { precision: "exact" })]));
  register(second, delta("correct", [operation(second.replace(/出発へ変更|へ変更/gu, ""), "start_date", secondValue,
    { action: "replace", precision: secondValue?.kind === "month_offset" ? "qualitative" : "exact" })]));
}
for (const [first, second] of [["金沢", "富山"], ["松江", "出雲"], ["奈良", "京都"]]) {
  register(`${first}を第一候補にする`, delta("confirm", [operation(first, "destination", { kind: "place_label", label: first }, { precision: "exact" })]));
  register(`${second}も候補に追加`, delta("consider", [operation(second, "destination", { kind: "place_label", label: second },
    { action: "add_alternative", modality: "acceptable", precision: "exact" })]));
}
const unknowns: ReadonlyArray<readonly [string, string, Operation["target"], Operation["value"]]> = [
  ["出発地は大阪です", "出発地は未定です", "origin", { kind: "place_label", label: "大阪" }],
  ["旅行期間は2泊です", "期間はまだ決めません", "duration", { kind: "quantity", amount: 2, unit: "nights" }],
  ["旅行予算は5万円です", "予算は未定に戻します", "budget", { kind: "money", amount: 50_000, currency: "JPY", basis: "trip" }],
];
for (const [first, second, target, firstValue] of unknowns) {
  register(first, delta("inform", [operation(first, target, firstValue, { precision: "exact" })]));
  register(second, delta("cancel", [operation(second, target, { kind: "unknown", reason: "undecided" }, { action: "set" })]));
}

export function semanticMultiTurnProviderFixture(userRequest: string): UtteranceInterpretation {
  const interpretation = provider.get(userRequest);
  if (!interpretation) throw new Error(`Missing provider fixture for ${userRequest}`);
  return structuredClone(interpretation);
}
