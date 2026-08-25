# ADR 0029: Agent EvaluationをSmokeとFullへ分離する

## 状態

採用

## 背景

Agent Evaluationの初期20ケースは決定論的に実行できるが 今後30件以上への拡張や
実Providerを使う主観評価を同じPR workflowへ追加すると 所要時間と利用料が増えやすい。
一方で通常unit testへEvalを混ぜると どの品質指標が失敗したかActions上で判別しにくい。

## 決定

- `Agent Eval / Smoke`をPRと手動実行で起動する
- Smokeはdatasetの`smoke` tagだけを固定observationで評価し 外部APIと実モデルを使わない
- `Agent Eval / Full`を手動と週次scheduleで起動し 全datasetを評価する
- 通常の`CI / Test`とAgent Evalを別Workflow 別checkとして扱う
- JSONとMarkdown reportを成功 失敗にかかわらずartifactへ保存する
- Smoke artifactは14日 Full artifactは30日保持する
- 6つの客観指標をreport内の閾値と比較し case失敗または閾値未達で非0終了する

初期閾値は決定論的fixtureに対して厳格に100%とし Unsupported Claim Rateだけ最大0%とする。
実モデルを使う評価は同じ閾値を無条件に流用せず 変動と利用料を確認して別profileで導入する。

## 結果

- PRでは11件の軽量Smokeだけを独立して確認できる
- Full 20件はPRを待たせず手動または週次で確認できる
- reportから失敗指標 実測値 閾値 caseを追跡できる
- artifactに秘密値や会話全文を含めず normalized observationと集計だけを置く
- Benchmark拡張時はtagでSmoke集合を小さく維持できる

## 検証

- Smokeが`smoke` tagのcaseだけを実行すること
- Fullが全caseを実行すること
- 閾値未達でreportへ失敗理由を出し runnerが非0終了すること
- 2つのworkflowが通常CIと独立してactionlintを通ること
