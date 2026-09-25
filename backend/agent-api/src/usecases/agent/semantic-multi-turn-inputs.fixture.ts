export interface SemanticMultiTurnInput {
  scenarioId: string;
  category: string;
  calendarDate: string;
  turns: string[];
}

const pair = (category: string, rows: ReadonlyArray<readonly [string, string]>): SemanticMultiTurnInput[] => rows.map((turns, index) => ({
  scenarioId: `${category}-${String(index + 1).padStart(2, "0")}`, category, calendarDate: "2026-09-25", turns: [...turns],
}));

/** Model-facing inputs only. Semantic operations and final-state gold live in
 * separate modules and are never placed in Runtime input. */
export const semanticMultiTurnInputs: readonly SemanticMultiTurnInput[] = [
  ...pair("correction", [["金沢に行きたい", "やっぱり富山に変更"], ["松江に行きたい", "やっぱり倉敷に変更"],
    ["奈良に行きたい", "やっぱり京都に変更"]]),
  ...pair("interest-addition", [["歴史を重視", "食事も追加して"], ["自然を重視", "温泉も追加して"],
    ["美術館を重視", "建築も追加して"]]),
  ...pair("day-scope", [["全体はのんびり", "2日目だけ活発に"], ["全体は活発", "3日目だけゆったり"],
    ["全体は標準ペース", "1日目だけのんびり"]]),
  ...pair("origin-retraction", [["大阪から出発", "出発地はいったん未定に戻す"], ["京都から出発", "起点はまだ決めない"],
    ["東京から出発", "出発場所の指定を取り下げる"]]),
  ...pair("hypothetical", [["一人旅です", "もし二人ならどうなる？"], ["2泊にします", "仮に3泊ならどうなる？"],
    ["予算は5万円", "もし8万円ならどうなる？"]]),
  ...pair("question", [["出雲大社に行きたい", "この地域の特徴は？"], ["高山に行きたい", "一般に旅行保険は必要？"],
    ["広島に行きたい", "新幹線と飛行機はどう違う？"]]),
  ...pair("modality", [["温泉は必須", "温泉は必須でなくてもよい"], ["美術館を優先したい", "美術館は候補程度でよい"],
    ["早朝出発は絶対なし", "早朝出発は避ける程度にする"]]),
  ...pair("relative-date", [["明日出発", "あさって出発へ変更"], ["あさって出発", "次の月曜へ変更"],
    ["今日出発", "来月出発へ変更"]]),
  ...pair("destination-alternative", [["金沢を第一候補にする", "富山も候補に追加"], ["松江を第一候補にする", "出雲も候補に追加"],
    ["奈良を第一候補にする", "京都も候補に追加"]]),
  ...pair("explicit-unknown", [["出発地は大阪です", "出発地は未定です"], ["旅行期間は2泊です", "期間はまだ決めません"],
    ["旅行予算は5万円です", "予算は未定に戻します"]]),
] as const;
