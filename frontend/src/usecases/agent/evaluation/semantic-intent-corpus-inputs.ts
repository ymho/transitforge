import type { SemanticIntentCaseInput } from "./semantic-intent-evaluation";

const family = (category: string, utterances: readonly string[], tags: readonly string[] = []): SemanticIntentCaseInput[] => utterances.map((utterance, index) => ({
  caseId: `${category}-${String(index + 1).padStart(2, "0")}`, category, utterance,
  ...(category === "relative-date" ? { calendarDate: "2026-09-25" } : {}), tags: [...tags],
}));

/** Public development corpus inputs. Gold operations live in a different module
 * and must never be passed to the Interpreter/model request. */
export const semanticIntentCorpusInputs: SemanticIntentCaseInput[] = [
  ...family("destination", ["出雲大社に行きたい", "金沢へ行きたいです", "目的地は松江", "倉敷を訪ねたい", "高山が第一希望", "長崎にして", "I'd like to visit 奈良", "行き先、富山でお願いします", "仙台を目的地に", "広島へ行く旅にしたい"], ["explicit", "place"]),
  ...family("origin", ["大阪から出発", "出発地は京都", "東京発で", "博多駅から行きます", "起点を名古屋にして", "札幌から向かいたい", "from 神戸", "横浜を出発地に", "今回は大宮発", "広島駅からお願い"], ["explicit", "place"]),
  ...family("duration", ["2泊くらい", "3泊で", "日帰りにしたい", "4日間を考えています", "1泊から2泊くらい", "5泊は必要", "三泊が希望", "2 daysくらい", "一週間ではなく6泊", "0泊の日帰り"], ["precision", "quantity"]),
  ...family("modality", ["温泉は必須", "温泉があると嬉しい", "温泉でもよい", "温泉は避けたい", "温泉は絶対なし", "食事を最優先", "美術館が好み", "自然も候補でいい", "混雑はなるべく避けたい", "早朝出発は禁止"], ["modality", "minimal-pair"]),
  ...family("retract", ["行き先は未定に戻して", "出発地をいったん消して", "予算条件は取り下げます", "温泉は不要", "日付を未定にして", "人数はまだ決めない", "3泊という条件を撤回", "帰りの条件だけ取り消して", "2日目のペース指定を元に戻す", "その候補の選択をやめる"], ["retract", "non-revival"]),
  ...family("hypothetical", ["もし雨なら屋内中心だとどうなる？", "3泊ならどんな案？", "大阪発にした場合は？", "子ども連れだったら楽しめる？", "予算5万円なら可能？", "帰りだけ新幹線なら？", "2日目を活発にするとしたら？", "温泉なしなら何がある？", "来月だった場合を見たい", "仮に一人旅ならどうなる"], ["hypothetical", "question"]),
  ...family("question", ["出雲大社の特徴は？", "一般に旅行保険は必要？", "新幹線と飛行機はどう違う？", "温泉地では何をするの？", "この条件で問題ありますか？", "さっきの案の根拠は？", "予約はいつ取るべき？", "雨は多い地域ですか？", "2番目の候補を説明して", "今の条件を確認したい"], ["question", "no-mutation"]),
  ...family("relative-date", ["明日出発", "あさってから", "今日行きたい", "次の月曜に出る", "来月にしたい", "明日から2泊", "あさって帰る", "次の金曜日が希望", "再来月ならどう？", "今日は無理で明日に変更"], ["relative-date", "trusted-clock"]),
  ...family("day-scope", ["2日目だけ活発に", "1日目はのんびり", "3日目だけ食事重視", "第4日は歩行を少なめに", "二日目は温泉なし", "5日目だけ早朝出発でもよい", "第1日は美術館を優先", "3日目の予算だけ抑えたい", "2日目に限ってバスを避ける", "十日目だけ自由時間多め"], ["scope", "logical-day"]),
  ...family("budget", ["一人あたり5万円まで", "旅行全体で10万円", "1泊2万円くらい", "一部屋3万円以内", "予算は約8万円", "per person 40000 JPY", "二人で合計12万円まで", "宿は一泊15000円程度", "食費は一人1万円", "総額は決めていない"], ["budget", "basis"]),
  ...family("alternative", ["金沢もあり", "食事重視も追加して", "温泉も候補で", "3泊でも大丈夫", "飛行機も候補に", "奈良か京都も検討", "のんびり案に加えて活発な案も", "帰りは新幹線でも構わない", "美術館だけでなく自然も", "ホテルのほか旅館もあり"], ["alternative", "preserve-unrelated"]),
  ...family("unknown", ["目的地はまだ分からない", "出発地は未定", "日付は決めていません", "人数は分からない", "予算は答えたくない", "宿にはこだわりなし", "移動手段は何でもよい", "期間は保留", "食事の希望は特にない", "同行者はまだ不明"], ["unknown", "profile-suppression"]),
];
