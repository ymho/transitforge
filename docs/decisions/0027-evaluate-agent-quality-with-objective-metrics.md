# ADR 0027: Agent品質を客観指標中心のdatasetで評価する

## 状態

採用

## 背景

Agent RuntimeはTool選択 制約の正規化 Grounding Viewer Actionを別々の責務として持つ。
最終回答の文章だけを人手またはLLM-as-a-Judgeで評価すると どの境界で退行したかを特定できず
同じ入力でも評価が変動する。

既存の経路検索にはofflineで再現できるscenario fixtureがあるため Agent評価でもその識別子と
境界条件を再利用できる。

## 決定

Agent Evaluationをversion付きdataset observation runner reportへ分ける。
初期datasetは20ケースとし 既存の経路検索scenarioを参照する。

次の指標はコードで判定する。

- Tool Selection Accuracy: Tool呼び出し順が期待と一致する割合
- Constraint Satisfaction: 期待した正規化制約が保持された割合
- Grounded Claim Rate: supportedな事実Claimの割合
- Unsupported Claim Rate: unsupportedな事実Claimの割合
- Task Completion: Runtime完了状態が期待と一致する割合
- Viewer Action Validity: 許可Actionだけが適用され 必須Actionを満たす割合

Runtime結果は`observeAgentRuntimeResult`でTrace Claim Viewer ActionからProvider非依存の
observationへ変換する。runnerはJSON reportと同じ内容のMarkdown reportを生成し
1件でもcaseが失敗した場合は非0で終了する。

LLM-as-a-Judgeは文章の自然さなど客観判定できない項目へ将来限定して使い 初期指標には使わない。

## 結果

- fixtureとobservationを固定すれば同じ結果を再現できる
- 指標ごとに失敗理由を確認できる
- 後続でSmoke用tagとFull datasetを同じ契約のまま分離できる
- observation fixtureは評価器自体の基準線であり 実Provider評価時はRuntime結果から置き換える
- dataset observation reportのschema変更にはversion更新が必要になる

## 検証

- 初期datasetが20ケースあり 参照するjourney scenario IDが存在すること
- 正常fixtureで全指標が期待値に一致すること
- Tool 制約 Claim 完了状態 Viewer Actionの各退行を個別に検出すること
- JSONとMarkdown reportを同じrunnerで生成できること
