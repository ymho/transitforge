# Epic #631 会話意味論の現行監査と移行台帳

- 基準commit（Epic記載）: `84faf820`
- 実装開始時main: `4a72002505e0686bcfd93a949c177780357dbd93`
- 開始時open PR: なし
- 更新日: 2026-09-25
- 対象: #632–#648、#650–#654

この文書の「実装」はproduction compositionから到達するコード、「scripted」は合成model/Providerを使う自動test、「live」は実modelまたは実Browserでの観測を表す。scripted成功をlive成功へ昇格しない。

## 実入口から保存まで

| 段階 | production owner / symbol | 正本・境界 |
| --- | --- | --- |
| REST/SSE turn受付 | `conversation-route` → `createConversationTurnApplication` | Cognito principal、owner scope、turn idempotency |
| user messageとlease | `DynamoDbConversationTurnRepository.beginTurn` | Conversation CAS、request hash、固定`calendarDate` |
| 意味候補 | `createConversationIntentInterpreter` | 現在発言だけのbounded Structured Output。未信頼 |
| 受理候補生成 | `acceptedIntentDeltaFromInterpretation` | app生成ID/provenance/revision、quote、clock、target/value検証 |
| 意味適用 | `reduceConversationIntent` | pure atomic-group reducer、tombstone、idempotency |
| A: 意味受理保存 | `DynamoDbConversationTurnRepository.acceptIntent` | TURN receipt + WORKING v2を単一transactionで保存 |
| context再読込 | `createServerStateContextLoader` | owner-scoped Conversation/Profile/Trip/Working State |
| 判断・Tool・回答 | `createStatefulServerAgent` → `MultiStepAgentRuntime` | native Tool、Evidence、bounded loop、answer/ask v4 |
| B: 回答保存 | `completeTurn` | assistant message、presentation/Evidence receipt、最新semantic merge |
| history/SSE | Conversation history / stream application | 公開artifactのみ。意味receiptの公開projectionは#644/#646 |

BrowserからWorking State、Profile、Trip本文、owner、revisionを受け取らない。TripとTripRequestは採用済み状態、Proposalは未採用変更案、Conversation semantic overlayは今回の会話で受理した疎な希望差分である。

## 能力・重複・移行台帳

| 能力 | 既存実装 | 2026-09-25の差分 / Issue | production到達・test | 移行・撤去対象 |
| --- | --- | --- | --- | --- |
| task/decision contract | `AgentTaskContext`、`SemanticDecision`、answer/ask v4 | 小さいutterance deltaを追加 #633/#637 | Server Runtime tests | legacy Decision Summaryはlegacy provider限定 |
| 会話継続 | Working State v1、presentation/Evidence/outcome | v2 semantic overlay/receipt #639 | Dynamo adapter-shaped tests | v1 read、v2 write、unknown拒否 |
| 日付 | `uiContext.calendarDate`、Trip temporal | app-owned relative-date解決 #635 | 2026-09-25→26 fixture | recovery regexを#645/#653で撤去 |
| 条件強度 | Trip requirement/assumptionの部分表現 | required/preferred/acceptable/avoid/forbidden #633 | pure parser/reducer tests | Prompt内の暗黙強度推測 |
| 訂正・撤回 | Trip Proposal/CAS、request validator | replace/retract/tombstone/relax/narrow #638 | pure reducer + failure tests | history要約からの復活を禁止 |
| scope/reference | PresentationReceipt、Trip/day/segment IDs | scope型は最小配置、resolverは#636 | parser testsのみ | 本文の「2番目」再parse |
| Effective Intent | server context compiler、Trip/Profile snapshot | base+overlay投影 #640 | 未実装 | 直近12 message依存 |
| action policy | Tool schema、SemanticDecision、progress guard | effective revision連携 #641 | 未実装 | LLM自己申告だけの不足判定 |
| invalidation/replan | Evidence applicability、PlanVariant、CAS | meaning dependency連携 #642 | 未実装 | 全消去・無条件再検索 |
| proposal/branch | Request Proposal、PlanVariant、Trip CAS | conversation delta接続 #643 | 未実装 | overlayからの直接Trip writeは禁止 |
| response/UI | typed presentation、history/SSE、既存cards | public meaning receipt #644/#646 | 未実装 | UI本文推測 |
| degraded path | verified Evidence summary、turn retry | A/B故障区別 #645 | A後failure/retry testあり | 独自自然言語補完を撤去 |
| eval/trace/security | Epic #537/#557/#558基盤 | #647/#648/#650/#651 | 初期diagnostic hookあり | raw state/CoTを追加しない |
| budget/rollout | bounded Runtime、feature env | default-off gate/read-old-write-new #652/#653 | Terraform/schema tests | 専用二重推論は暫定 |

既存#537のAgent、Evidence、Variant、Context、evaluationを再利用し、新しい汎用Planner、event store、Trip複製を作らない。#559/#589のUIと#561の評価成果は置換せず、意味receiptと追加scenarioを接続する。

## 失敗分類

| phase | 代表症状 | 判定元 | 修正owner |
| --- | --- | --- | --- |
| interpretation | 許容を必須、質問をassertionとして抽出 | interpretation outcome / gold expected | #633/#637/#648 |
| reference-resolution | 「2番目」が古いpresentation/別Tripを指す | presentation + owner/revision resolver | #636 |
| authority | Profile推測がuser-confirmed、会話がTripを直接変更 | source/authority policy | #634/#651 |
| reduction | 追加が置換、groupの一部だけ適用 | reducer receipt | #638 |
| persistence | 回答失敗で消失、再送で二重適用 | A receipt / intent revision | #639 |
| context | 履歴切詰めで古い条件復活・消失 | effective intent hash/revision | #640 |
| action-policy | 既知値を再質問、条件違反Tool入力 | requirement policy reason | #641 |
| evidence | 古い日付の結果を新revisionで採用 | applicability/dependency ref | #642 |
| response | 本文と受理state/カードが矛盾 | public receipt + presentation | #644 |
| UI | reload/別タブでcurrent/stale表示が不一致 | server receipt/revision | #646 |
| evaluator | 最終成功が途中失敗を隠す、expected混入 | per-turn observation / runner manifest | #647/#648 |

原因を一括して「AI品質」としない。schema validでもinterpretation、authority、scopeが誤れば失敗である。

## 独立した自然言語解釈の撤去台帳

| 現行箇所 | 種別 | 現行目的 | 後継契約 | 削除条件 / 保持条件 |
| --- | --- | --- | --- | --- |
| `agent-runtime.ts::verifiedPlanningSummary` | regex (`明日`等) | Provider failure時の日付継続 | accepted semantic overlay + degraded presenter #645 | 明日/明後日/月末/言い換えの2turn回帰後に語句抽出を削除。検証済みEvidence summaryは保持 |
| `planning-draft-recovery.ts::recoverPlanningDraft` | recovery/default | draft条件補完 | Effective Intent + receipt #640/#645 | 同等failure fixture後に自然言語抽出を削除。schema/date validationは保持 |
| system/model Prompt | 自由文指示 | 強度、質問、Tool判断 | semantic schema + action requirement policy #633/#641 | model表現指示は残せるがstate確定の第二正本にしない |
| legacy Decision Summary parser | legacy text parser | provider移行 | answer/ask v4 + native Tool | legacy provider期限中のみ。strict出力へfallback適用しない |
| Conversation history/summary | implicit recovery | 過去条件想起 | Working semantic overlay #640 | 表示文脈として保持、確定条件抽出には使わない |
| UI proposal/card inference | UI推測 | pending/current表示 | public semantic/proposal receipt #644/#646 | receipt接続後に自然言語・カード存在による推測を削除 |

UUID、owner、revision、schema、暦日、文字数/bytes、Evidence reference、CAS、認可のvalidatorは撤去対象ではない。新経路が再現ケースと言い換えケースを通る前に旧縮退を削除しない。

## 最小fixtureと現時点の判定

| 系統 | scripted layer | 現時点 |
| --- | --- | --- |
| 目的地→日付 | production turn app + Dynamo-shaped adapter | 受理・継続。full Server同一turn入力も確認 |
| 許容≠必須 | parser/reducer + turn app | `acceptable`を保持 |
| 訂正・未定へ戻す | reducer + turn app | replace/retract+tombstoneを保持 |
| 候補2番目 | bounded interpreter outcome | **未実装**。安全にunsupported/no mutation。#636でreceipt resolverへ接続 |
| 元案を保持 | reducer + turn app | `add_alternative`で既存fact保持。PlanVariant化は#643 |
| Provider failure後の再送 | turn app + Dynamo-shaped adapter | A前は再解釈、A後はreceipt replayし状態保持 |

## Wave 1 実行記録

- branch: `feat/631-wave1-semantic-acceptance`
- 実装開始SHA: `4a72002505e0686bcfd93a949c177780357dbd93`
- 自動test: `npm test`（frontend 1718、agent-api/runtime 1090、stream contract 5、全件成功）、`npm run workspace:check`、`npm run architecture:check`、`npm run build`（全て成功）。`npm run eval:agent:smoke`は12/12成功。
- 実model、実Provider、実Browser、deployment: この表の作成時点では未実施。scripted fixtureの成功と区別する。
