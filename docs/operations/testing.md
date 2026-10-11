# Agent v2 テスト戦略 — greenfield acceptance

本番診断では、モデル呼出し前のApplication入力拒否を`v2:turn_input:invalid_input`、
`v2:turn_input:unresolved_intent`、`v2:turn_input:context_budget`に分ける。
本文・Trip ID・認証情報・例外本文は記録しない。入力拒否ではモデルを呼ばず、
上限や入力検証を緩和しない。この診断変更だけでは保存の失敗を解決したとは扱わない。

会話継続の送信コピーは64,000文字まで許容する。以前の24,000文字では、日付付きの鉄道と
1泊の宿を保存した7件の旅程で、日別集計・候補・対話を含めると通常の再相談が拒否された。
この値はモデルのトークン上限ではなく、Applicationデータ用の文字数上限である。
超える場合、モデルへ送るコピーから古い保持Evidence、次に古い対話を全件単位で省く。
`contextCoverage`で省略件数を明示し、直近2発言は維持する。
現在発言・EffectiveIntent・現在Trip（派生日別集計を含む）・画面の選択対象・提示候補のID/名称は切断しない。
これらだけで上限を超える場合は引き続き拒否する。Serverに保存した履歴とEvidence、
Applicationの根拠検証・採用権限は変更せず、モデルには保持候補の種別と識別子を渡す。
モデルの出力予算・実行時間・Tool回数は変更しない。

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
   - Tool exposure and authenticated mutation authority
   - model/tool/deadline budget
   - no Strands Session/Memory source of truth
4. **Live quality**
   - bounded real-model evaluation
   - useful answer、不要質問、latency、Tool/model call、token/cost

## V1専用テストの撤去

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

## 実行終了の診断

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

## v2表示境界

`assistant-turn-projection.test.ts`は本文だけのturnもlive/historyで同じobject型になり、
legacy state/Provider/Traceを投影しないことと候補ID・順序の保持を確認する。
各public cardのSSE→HTTP履歴→同じDOM投影、Proposalの履歴復元が自動保存しないこと、
現在のreceiptだけでServer Tripを再取得すること、feedbackへartifact metadataを送らないことを維持する。
通常CIの`test:agent-cutover:browser`はnative SDKと認証済みApplicationの保存を通った宿泊カードを、
Chromiumのページ再読込後にServer履歴から取得・描画し、追加のmodel/Provider呼出しがないことを確認する。
これは合成Provider/モデルとDynamoDB command fixtureによるブラウザ検証であり、実AWS/model/Providerの製品E2Eではない。
旧表示用の独立workflowはなく、現行CI/v2 Acceptance/Smoke/CDを引き続き使う。

## Trip V2 の製品横断評価

### 合否の境界

候補の有用性、Tripの保存状態、Evidence、部分失敗からの継続、処理時間・Tool/モデル呼出・使用量を別々に記録する。
文言、Tool名の固定順や候補の完全一致を合否条件にしない。owner越境、未承認更新、予約/購入との混同は他の成功で相殺しない。
実行できなかったケースは `not_run` とする。合成モデルや固定DOMを実Bedrock、実Provider、実ブラウザの成功とみなさない。

`tools/trip-v2-product-gate.ts` は以下の各シナリオに、状態、実Bedrock＋固定Provider、実Provider、PCブラウザ、モバイルブラウザ、デプロイ済み版の証跡を要求する。実行記録は会話文やProviderの生データを含めず、case、stage、結果、commit、GitHub Actions run、失敗理由、重大違反、数値だけをJSONへ記す。

| case | 対話と確認する状態 |
| --- | --- |
| `destination-interest` | 出雲大社への興味と言い換え。日程なしでも写真/根拠付き紹介と周辺候補、イベント検索だけ失敗した部分結果 |
| `experience-discovery` | 歴史・食などの体験から違いのある複数候補を比較。人数なしで開始し、選択後に仮旅程 |
| `concrete-itinerary` | 2泊3日、2日目昼食、交通/宿泊の後選択、一部確定、立ち寄り、明示再編集/仮戻し。what-ifと検索の未採用時はTrip不変 |
| `branch-and-reload` | Tripと会話履歴の分岐、片方だけの変更、両方の再読込。元履歴の権限・予約の流用禁止 |
| `partial-failures` | 雨予報/予報期間外/取得失敗、飲食店0件/検索失敗、イベントだけ失敗を区別して対話継続 |
| `condition-and-concurrency` | 空/3項目Profile、メモAI利用OFF、Tripの明示条件優先、訂正・撤回・日程変更、別owner、遅着・再送・CAS競合 |

## 既存の局所証拠と残る実行

本番streaming AgentのTrip書き込み権限は`dynamodb:EnclosingOperation=TransactWriteItems`に限る。旅程案・検索候補・採用previewの保持も単一Putのトランザクションを使い、条件付きの不変性と同一内容の再送を維持する。通常Putが通るfixtureだけではこの制約を検証できないため、候補Repositoryの回帰fixtureは通常Putを拒否する。本番診断は正常完了した回答の内部Tool失敗も、Tool名・許可されたerror code・件数・時刻だけで集計する。

`npm run test:trip:v2:reported-live` は報告された出雲相談を10ターンで確認する。通常は合成SDK、`AGENT_V2_LIVE=true` では初回の紹介から最後の経路採用まで全ターンが実Bedrockとなる。手動workflowの `reported-trip-flow` は1回最大10ターン×8モデル呼出、各ターン90秒、出力上限4096、独立反復1または3回で実行する。3件の宿の曖昧な保存は無更新、ホテル名・経路番号の選択はApplicationの保存処理を使い、履歴再読込・再送・外部ホテルID・別ownerの拒否を確認する。Provider、認証主体、DynamoDBはfixtureのため、実Providerや実ブラウザの合格には数えない。

未選択の往路・帰路を含む旅程では、検証済み検索候補の日付とIANAタイムゾーンが全候補について同じ一枠に一致する場合だけ保存先を特定する。保存済みcalendar bindingを優先し、bindingが空の場合だけ、旅程全体に適用するユーザ指定の確定開始日を最初のlogical dayへ一時的に結び付ける。日程のタイムゾーンが未指定なら、検証済み候補で一致した唯一のzoneを照合用に使う。この計算はTripの日程や他の予定を更新しない。開始日が未定・範囲・複数、zone不一致、同日に複数枠なら保存先を推測しない。明示された相談対象の枠がある場合はそちらを優先する。

- 状態・Repositoryと合成SDKの局所試験: `backend/agent-api/src/composition/strands-place-cards-acceptance.test.ts` は候補カード、履歴保存、再送、owner越境を確認する。`backend/agent-api/src/composition/epic-537-product-e2e.test.ts` は候補採用、再読込、局所変更を確認する。`backend/agent-api/src/usecases/agent/trip-gap-place-tool.test.ts` と `trip-gap-restaurant-tool.test.ts` は天気の部分失敗を扱う。これらは実Providerや実画面の証拠ではない。
- 実Bedrock＋固定Provider: `.github/workflows/strands-v2-live.yml` の `trip-v2-product` は `strands-trip-product-live.test.ts` の3種の入口を実Strands/Bedrock、隔離したTrip、固定Providerで確認する opt-in 経路。1回につき最大3ケース×8モデル呼出、各turn 60秒で実行する。分岐・変更・部分失敗を含む残りのcaseや各caseの縦断完了は別途記録が必要で、単発Runを六つの縦断caseの合格へ読み替えない。
- 実Provider: 本番と同じ接続を使って観光/写真/飲食/天気を各caseで取得し、Evidenceの出典と時刻、取得不可の状態を記録する。写真の表示確認はProvider応答とは別に画面で行う。
- PC/モバイル: ログインした実ブラウザで候補カードと写真、旅程/相談の移動、保存・再読込・分岐・差分確認を操作して記録する。preview/固定DOMは代用不可。
- デプロイ: mainのCI、Agent Acceptance、CDのSHAとRunを照合する。CI成功だけでブラウザ側の再読込成功を断定しない。

`npm run eval:trip:v2 -- /tmp/trip-v2-observations.json /tmp/trip-v2-report.json --require-all` は記録漏れ・失敗を非ゼロ終了にする。入力は配列で、要素例は `{ "scenario": "partial-failures", "stage": "real-provider", "status": "not_run", "commit": "<40桁SHA>", "reasons": ["weather_failure_not_exercised"] }`。`passed` には実行したGitHub Actions Run URLを必須とする。集計結果の `missing` と `failed` を残件としてIssueへ記録する。

現段階では全caseの実Provider・両ブラウザ実行と実Bedrock縦断を未完了として扱う。#751/#758のクローズは各段階の記録と実際の不具合の解消後に判断する。

相談履歴の読み戻し失敗はブラウザの `conversation_read_failed` で確認する。履歴取得と描画の段階、固定されたAPI操作名、通信／HTTP境界、HTTPステータスのみを記録する。ユーザ発言、応答本文、Trip ID、認証情報、元の例外は記録しない。診断の追加自体は実画面の読み戻し成功を意味しない。

## 再現可能なブラウザ確認

`tools/verify_unified_consultation.mjs`は実Shell・相談画面・Trip workspaceとCSSを固定メモリ状態で組み合わせる。1440px/390pxで新規Hero→送信→旅程→旅程の相談→旅程へ戻る→新規Heroを操作し、可視性・対象Trip・横溢れ・composerとメニューの重なりを検証して画像を保存する。実API/Bedrock/認証済み実ユーザーの検証とは分ける。

```sh
npm run dev --workspace @raiquora/frontend -- --host 127.0.0.1 --port 5178 --strictPort
# 別の端末。Playwrightは分離環境へインストールしてPLAYWRIGHT_MODULEを指定できる。
PLAYWRIGHT_MODULE=/tmp/visual-tools/node_modules/playwright/index.mjs \
  node tools/verify_unified_consultation.mjs .artifacts/unified-consultation
```

生成画像やverification.jsonは検証artifactであり、本番配信には含めない。実行対象もlocalhostに限定する。
