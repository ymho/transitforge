# ADR 0048: 構造化されたAgent phaseだけをdecision modelへ送る

- ステータス: Accepted
- 日付: 2026-09-02
- 関連: ADR 0031 0038 0044 0047 Issue #320

## 背景

Issue #306でBedrockを意思決定主体とし 発話routerと固定Plannerを削減した。
Issue #320のLive Evalでは Nova Lite単体が旅行開始の条件確認に強く Nova 2 Liteが
`currentJourney`の変更とTool結果後の再計画に強い補完関係を示した。

自然文やTool名によるroutingはApplicationへintent判断を戻す。常時二層化やReflectionは
model callを増やす。一方 ADR 0047は provider非依存classを同じBenchmarkで比較し
品質維持 model/tool call非増加 latencyまたはtoken 10%以上改善を確認した場合に限り
本番routingを認めている。

## 実測

同じSmoke 6件を各3回実行した。

| 戦略 | stable | complete attempts | latency合計 | token合計 | model call | tool call |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Nova Lite単体 | 4/6 | 0/3 | 19,103ms | 80,282 | 21 | 21 |
| 構造化phase routing | 6/6 | 3/3 | 16,968ms | 81,266 | 21 | 21 |

routingは品質を改善し model/tool callを増やさず latencyを11.2%短縮した。tokenは1.2%増えた。
Full 11件は最終候補を3回反復し stable 11/11 complete attempts 3/3だった。
Constraint Satisfaction Task Completion Viewer Action Validityも100%だった。曖昧な気分だけの
目的地発見は、具体的な`tripContext`がなく`travelProfile`だけがある初回発見として
decision classへ送ることで安定した。

## 決定

- `concierge`の候補発見段階は、具体的な目的地の有無にかかわらず、発話本文を分類せず
  構造化された`planningStage=inspiration`または未作成の`tripContext`から`decision` classを使う
- `planningStage=planning`で日付と泊数が揃った旅行計画は`decision` classを使う
- 検証済み`currentTrip`または`currentJourney`がある照会と変更は`decision` classを使う
- 日付または泊数が不足する条件確認は`default` classを使う
- Tool結果を受けた結果駆動再計画は`decision` classを使う
- 発話本文 目的地 Tool名 個別業務ケースではroutingしない
- model callを追加せず 同じ`MultiStepAgentRuntime`を維持する
- Applicationは`default`と`decision`だけを扱い model IDはBedrock AdapterとTerraformへ閉じる
- devの既定modelはNova Lite decision modelはJP Nova 2 Lite inference profileとする
- class別modelが未設定なら既定modelへフォールバックする
- Inference Profileと参照先の基盤modelだけをIAMで許可する

## 影響

- 既知条件の質問と既存旅程の変更が同じRuntimeで安定する
- 常時Reflection Multi-Agent 発話routerを追加しない
- model構成を戻す場合は`bedrock_decision_model_id`を空にすれば単一modelへ戻せる
- Live Evalの反復数をmodel routing artifactへ保持し 異なる反復数を比較しない
- Tool名と実際の能力を一致させる。`search_accommodations`は宿だけでなく往復鉄道経路も
  同じ日程で組むため、その責務をdescriptorへ明記する
- 曖昧な気分からの発見はFull Benchmarkへ残し、初回発見全体の品質とコストを継続評価する

## 確認

- `npm test`
- `npm run build`
- `npm run architecture:check`
- `npm run workspace:check`
- `npm run eval:agent:smoke`
- `npm run eval:agent:decision:live -- --profile smoke --model-routing structured-decision --repetitions 3`
- `npm run eval:agent:decision:live -- --profile full --model-routing structured-decision --repetitions 3`（11/11 stable）
- `terraform fmt -check -recursive infra/terraform`
- `terraform validate`
- GitHub Environmentの全変数を与えた`terraform plan -refresh=false`
