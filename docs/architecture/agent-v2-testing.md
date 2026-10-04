# Agent v2 テスト戦略 — greenfield acceptance

本番診断では、モデル呼出し前のApplication入力拒否を`v2:turn_input:invalid_input`、
`v2:turn_input:unresolved_intent`、`v2:turn_input:context_budget`に分ける。
本文・Trip ID・認証情報・例外本文は記録しない。入力拒否ではモデルを呼ばず、
上限や入力検証を緩和しない。この診断変更だけでは保存の失敗を解決したとは扱わない。

会話継続で24,000文字を超える場合、モデルへ送るコピーから古い保持Evidence、
次に古い対話を全件単位で省く。`contextCoverage`で省略件数を明示し、直近2発言は維持する。
それでも超過する場合だけ、現在Tripから再生成できる日別集計`workload`を送信コピーから
全体単位で省き、`contextCoverage.omittedDerivedTripFields`に`workload`を明示する。
欠落した集計を0や確定した負荷と解釈しない。保存したTripと集計計算自体は変更しない。
現在発言・EffectiveIntent・Trip項目と日別配置・画面の選択対象・提示候補のID/名称は切断しない。
これらだけで上限を超える場合は引き続き拒否する。Serverに保存した履歴とEvidence、
Applicationの根拠検証・採用権限は変更せず、モデルには保持候補の種別と識別子を渡す。

Agent v2はStrandsを使うgreenfield実装であり、V1 `MultiStepAgentRuntime` の内部挙動を再現することを目的にしない。

## Cutover gateの優先順位

1. **Domain / Repository invariant**
   - owner、CAS、Trip/Profile/Reservationの正本
   - turn idempotency / replay
   - accepted semantic state
2. **Application boundary**
   - Effective Intent
   - Tool input / intent dependency
   - Evidence admission / claim validation
   - A/B commit
3. **Agent v2 execution boundary**
   - Strands model→Tool→model loop
   - read-only Tool exposure during the current migration phase
   - model/tool/deadline budget
   - no Strands Session/Memory source of truth
4. **Live quality**
   - bounded real-model evaluation
   - useful answer、不要質問、latency、Tool/model call、token/cost

## V1専用テストの撤去（#788）

V1のrepair本文・finalization順序・guard発火順・旧renderer・旧model routing・duplicate suppression方式と、
それらに依存するLive Eval、workflow、fault catalogは撤去した。
保存・CAS・owner・Evidence・条件受理後の失敗/再送は現行v2 acceptance catalogとApplication境界のテストを維持する。
Tool catalog未公開のproposal登録/保存は`proposal-runtime.fixture.ts`でApplicationのruntime portを通して検証する。
これはv2が当該Toolをモデルへ公開済みであるという保証ではない。
API/保存形式の`v1`、地点詳細のBedrock要約とそのテストは旧Runtimeの撤去対象にしない。
画面の旧union・質問ガイド・外部カードと専用テストは#721で撤去した。
text-onlyを含む全turnを同じAssistantTurnViewへ投影する。保存receipt・Proposalの検証は残す。

## V2で再表現する原則

V1 testが守っていたものにユーザー可視の意味がある場合、内部挙動ではなく結果のInvariantとして書き直す。

例:

- 「repairが2回走る」ではなく「未検証Claimを公開しない」
- 「finalization Toolを拒否する」ではなく「budget後に新しいProvider副作用を実行しない」
- 「planning guardが発火する」ではなく「事実を伴う旅行提案にはadmitted Evidenceがある」
- 「既知条件を聞くrepair promptを拒否する」ではなく「accepted Effective Intentを再質問しない」

## V2 acceptance catalog

`backend/agent-api/src/composition/agent-v2-acceptance-catalog.ts` をcutover gateの索引とする。

分類:

- `shared_invariant`: Agent実装によらず必要。既存Application/Repository testを再利用する。
- `v2_specific`: Strands/Application boundaryを直接検証する。
- `deferred`: 移行段階上まだV2に能力を公開していない。V1 testを借用せず、能力接続時にV2 testを新設する。

catalog testは、active gateがV1の `agent-runtime.test.ts` / `research-runtime-enforcement.test.ts` を参照しないことを強制する。

## 自動CIでの重複実行を避ける

`test:agent:v2`の40ファイル中39ファイルは通常の`npm test`が確認する。PR/mainの
`Agent v2 / Acceptance`は残る`tools/trip-v2-product-gate.test.ts`だけを実行し、既存check名を維持する。
architectureとtooling typecheckも通常CIで1回だけ実行する。全Acceptanceの独立調査は
`npm run test:agent:v2`または手動Workflowの`full_suite=true`で行う。

`CI / Test`はTypeScriptテスト、build/Python、ブラウザ、Terraformを並列実行し、全て成功したときだけ既存`test` checkを
成功にする。failure/cancelled/skippedはgate失敗となり、CDもWorkflow全体の成功を引き続き要求する。
検証範囲を減らすpath filterや、成功扱いにするskipは導入しない。
Browserはbuild成功後に同じWorkflowのViewer artifactを取得し、stream/replayに加えて初期表示と
12時間ログイン維持を確認する。ViewerはCI内で1回だけbuildし、CDは従来どおりproduction設定でbuildする。

## 追加テストの判断

新しいV2 testは次の場合に追加する。

- 新しいauthority / persistence / Evidence / budget境界を接続した
- real-model evaluationで再現可能な**一般化された**failureを検出した
- user-visible invariantが既存shared testで確認できない

次の場合には追加しない。

- 特定modelの一時的な文言揺れ
- V1内部guard名を再現するだけ
- Prompt本文やmodel call回数の完全一致
- 旧Runtimeのprivate class/phaseを固定するためだけのassertion

関連: #631 #681 #691

## 実行終了の診断（#735）

V2は既存の`agent_diagnostic` sinkへ`phase=execution`を通知する。Strandsの実行終了と、
Applicationによる回答公開（従来の`phase=runtime`）、Conversation保存（`phase=save`）を分ける。
例えばSDKが`endTurn`で終了しても、構造化回答がなければexecutionはcompleted、runtimeはfailedになる。
execution単独を製品成功・保存成功として集計しない。

`stopReason`はBackendの固定allowlistであり、SDK結果全体・本文・例外messageはログへ渡さない。
`limitOutputTokens`は`output_token_budget`、`limitTotalTokens`は`total_token_budget`、
`limitTurns`は`iteration_budget`、単一model出力の`maxTokens`は`model_output_limit`へ分類する。
Adapterが確定した`limitReason=deadline/tool_calls`は別フィールドで保持し、時間切れとTool上限を区別する。
未認識の文字列はunknown、SDK結果を取得できなかった例外はnot_recordedとする。

`counts`はmodelCalls、read ToolのtoolCalls、inputTokens、outputTokens、totalTokensだけをコピーする。
有限な非負の安全整数だけを受理し、欠測を0へ置換しない。特にinvokeがthrowした場合、
使用量を取得できなかったことは無料・呼出し0回を意味しない。数値は既存EngineがSDKから取得した集計であり、
請求額の確定値ではない。条件更新・構造化出力の内部Toolはread Tool回数に含めない。
診断sinkが失敗しても再invoke、回答の差替え、公開検証の緩和を行わない。

診断は専用callbackから既存sinkへ渡し、Agentの公開結果・SSE・会話履歴へ新規フィールドを追加しない。
既存の内部executionIdによるログ相関は維持し、公開されるActions集計からはIDを除外する。
`tools/deployment/summarize-agent-diagnostics.mjs`は停止理由別の表を追加し、各数値を
`最大値 (計測件数/該当イベント件数)`で表示する。合計・percentile・相談件数ではない。
旧ログに存在しない停止理由や使用量を復元したとは扱わない。

通常のV2 Acceptanceに含まれる`strands-runtime-diagnostics.test.ts`で、usage付き合成モデルを
実SDKへ通し、累積4096に対して出力4800となる停止を、Conversation→診断sink→実CLIまで検証する。
この数値は合成metadataであり、実Bedrockの観測ではない。診断を履歴へ保存しないこと、例外時の欠測、
sink障害時の結果維持、未知値・不正数値・本文の除外も確認する。
集計単体の負例は`node --test tools/deployment/*.test.mjs`で実行する。

本変更は診断の追加であり、model、prompt、4096の出力上限、150秒の時間上限、retry方針、IAM、
デプロイworkflowを変更しない。実Providerを使うopt-inテストのskipや通常CI成功を、
実ブラウザでの症状解消・本番ログの取得成功として扱わない。デプロイ後の再現と診断照合が別途必要である。

## v2表示境界（#721）

`assistant-turn-projection.test.ts`は本文だけのturnもlive/historyで同じobject型になり、
legacy state/Provider/Traceを投影しないことと候補ID・順序の保持を確認する。
各public cardのSSE→HTTP履歴→同じDOM投影、Proposalの履歴復元が自動保存しないこと、
現在のreceiptだけでServer Tripを再取得すること、feedbackへartifact metadataを送らないことを維持する。
通常CIの`test:agent-cutover:browser`はnative SDKと認証済みApplicationの保存を通った宿泊カードを、
Chromiumのページ再読込後にServer履歴から取得・描画し、追加のmodel/Provider呼出しがないことを確認する。
これは合成Provider/モデルとDynamoDB command fixtureによるブラウザ検証であり、実AWS/model/Providerの製品E2Eではない。
旧表示用の独立workflowはなく、現行CI/v2 Acceptance/Smoke/CDを引き続き使う。
