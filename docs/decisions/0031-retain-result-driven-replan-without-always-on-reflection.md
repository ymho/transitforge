# ADR 0031: 結果駆動再計画を維持し常時Reflectionは採用しない

## 状態

採用

## 背景

Multi-step Agent RuntimeはTool結果をモデルへ返し 次の手順を判断する結果駆動再計画を行う。
ここへ回答前のReflection model callを常時追加すれば誤りを減らせる可能性がある一方
latency token利用量 実装と評価の複雑性が増える。

新しい手法名を理由に本番へ追加せず Domain Benchmark上の品質と相対コストを比較して
採否を決める必要がある。

## 仮説

Tool結果に応じた再計画は回復可能なTool選択 制約 複数Toolの失敗を改善する。
一方 常時Reflectionは結果駆動再計画から品質を改善せず model call分のlatencyとtokenを増やす。

対象は38件Benchmarkから次の8件とする。

- 曖昧な駅名
- 運休反映
- 遅延分析を含む経路比較
- 駅照会後の経路検索
- 出発地不足
- 遅延反映
- 新幹線除外
- 列車照会

## 比較

固定Provider相当の決定論的fixtureで single pass 結果駆動再計画 常時Reflectionを比較した。
latencyとtokenはProvider料金ではなく model call単位の固定コストで再現する相対値である。

| 戦略 | 成功 | 平均latency | 平均model call | 平均token |
| --- | ---: | ---: | ---: | ---: |
| single pass | 4/8 | 80ms | 1 | 250 |
| 結果駆動再計画 | 8/8 | 160ms | 2 | 500 |
| 常時Reflection | 8/8 | 240ms | 3 | 750 |

## 決定

既存の結果駆動再計画を維持する。常時Reflectionは採用しない。

結果駆動再計画は対象caseの完了率を50%から100%へ改善した。常時Reflectionは完了率を
追加改善せず 結果駆動再計画より相対latencyとtokenが50%増えたため 複雑性に見合わない。

Reflection専用prompt model call 本番flagは追加しない。将来Benchmarkに結果駆動再計画で
解けない具体的な失敗が増えた場合に そのcaseだけを対象として再評価する。

## 検証

```bash
npm run eval:agent:strategies
```

JSONとMarkdown reportへ仮説 対象case 3戦略の品質 latency model/tool call tokenと
採否理由を出力する。実験fixtureの欠損 未知case 不正な計測値は失敗として扱う。
