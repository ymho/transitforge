# Epic #537 現行能力台帳と本番経路

- 基準commit: `ddd5ac9bdecd3995c5e615c5afc7393dd17d7f2a`
- 実装開始時main: 同commit（基準以降の関連差分なし）
- 更新日: 2026-09-23
- 対象: #538、Epic #537の後続batchが共有する契約境界

## 本番呼出経路

| 段階 | Current owner / symbol | 正本・検証 |
| --- | --- | --- |
| REST turn受付 | `conversation-route` → `createConversationTurnApplication` | trusted principal、owner scope、turn idempotency |
| 状態読込 | `createServerStateContextLoader` | Conversation/Profile/Tripをserver-sideでowner検証、bounded history |
| 意味判断 | `agent-runtime` / `AgentTaskContext` / `SemanticDecision` | モデルは意味解釈、コードはaction/tool/target/missing requirementを検証 |
| Tool実行 | `server-tools` → Domain/Application operation | capability、入力schema、Evidence mapper、bounded loop |
| 表示観測 | `AgentTurnObservation` / `PresentationReceipt` | 実際に表示したprogress/ref/mediaだけを記録 |
| 完了保存 | `DynamoDbConversationTurnRepository.completeTurn` | assistant message、receipt、Working Stateを単一transactionで保存 |
| 再読込 | `getWorkingState` → `createServerStateContextLoader` | owner+conversation、Trip参照整合、前回outcomeと提示候補ordinal |

Browserから会話履歴、Profile、Trip本文、Working Stateを受け取らない。`Trip.items` / scheduleは採用済み旅行の正本であり、Working Stateは提示済み参照と未完了参照のみを保持する。

## 能力台帳

| ID | 能力 | 2026-09-22 Current | 契約 / 実測入口 | 次batch |
| --- | --- | --- | --- | --- |
| F01 | 複数日・多都市Trip正本 | 部分対応 | `modules/trip`、Trip V2、CAS | PR3/5 |
| F02 | 相対日と再送時計 | 対応 | `uiContext.calendarDate`をturn request hashへ固定 | PR3でlogical dayへ拡張 |
| F03 | 会話継続・提示候補参照 | 基盤対応 | versioned `ConversationWorkingState` / `PresentationReceipt` | PR6で公開presentationへ接続 |
| F04 | typed意味判断 | 基盤対応 | `AgentTaskContext` / `SemanticDecision` / `MissingRequirement` | PR2でStructured Outputs主経路化 |
| F05 | production-shaped評価 | 対応 | dataset-v5、input/expected分離、42 cases + 47 progress scenarios + 3 live conversations | 全batchで追加 |
| F06 | bounded Agent runtime | 対応 | max model/tool calls、deadline、Trace | PR2/7 |
| F07 | owner-scoped read/write | 対応 | server-side state loader、Trip repository、CAS/idempotency | PR7 negative tests |
| F08 | Evidence付き旅行提示 | 部分対応 | Evidence registry、ADR 0073 presenter | PR4/6 |
| F09 | 日付未定・夜行・時差 | 未対応 | 現行scheduleでは表現不足 | PR3 |
| F10 | 費用・成立性・負荷 | 部分対応 | Cost proposal / adopted feasibility | PR3/5 |
| F11 | 複数旅行案と比較 | 未対応 | 単体candidate中心 | PR5 |
| F12 | 部分再計画・robustness | 未対応 | Trip proposal/CASは存在、scenario差分なし | PR5 |
| F13 | Structured Output / cache / context compiler | 未対応 | text decision summaryが主経路 | PR2 |
| F14 | Knowledge/Rerank discovery | 未対応 | Web/POI adapterのみ | PR4 |

「対応」は本番と同じApplication/Domain契約に到達することを指す。Live model、実Provider、費用が必要な測定はmanifestで区別し、未実施を合格扱いしない。

## 評価契約

dataset-v5は`input`と`expected`を別objectにし、Runtime組成へ渡せるのは`input`だけとする。時計、利用者turn、Provider fixtureの選択もinput側に置く。expected、case ID特例、期待目的地・期待日付をcontextやTool結果生成へ渡さない。

写真数はProvider response内URL数ではなく、`AgentTurnObservation.progress[].mediaRefs`としてpresentationが実際に公開した数で測る。構造化観測がない場合は0件であり、本文regexやProvider出力で補完しない。Live実行はmodel ID、反復、fixture boundary、表示観測源、token、latency、costの取得可否をmanifestへ残す。

## 共有契約の所有

- `modules/agent/runtime`: task、decision、turn observation、Working StateのProvider非依存契約
- `backend/agent-api/src/usecases`: owner-scopedな状態構成とturn完了
- `backend/agent-api/src/adapters`: DynamoDB transaction、Bedrock等のProvider詳細
- `frontend/src/usecases/agent/evaluation`: 入力/期待値parserと客観評価

後続laneはこの契約をmainへ統合してから利用し、未統合interfaceを個別に複製しない。

## PR7 最終能力マップ

`実装`、`fixture`、`Live実測`、`本番有効化`を別状態として記録する。`—`は未測定/未接続であり0点や失敗率0%ではない。

| 能力 | 型 | pure計算 | Server組成 | Tool到達 | 公開wire | UI | 保存 | 自動test | 実モデル測定 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 相対日・日別・夜行・時差 | 済 | 済 | 済 | read済 | 済 | 済 | Trip V3 | 済 | — |
| scoped制約・負荷 | 済 | 済 | 済 | read済 | 済 | 済 | Trip/派生 | 済 | — |
| Evidence/applicability/lineage | 済 | 済 | 済 | discovery済 | 済 | 済 | observation ref | 済 | — |
| Cost/feasibility/variant/scenario | 済 | 済 | 済 | proposal済 | 済 | 済 | Candidate/Trip分離 | 済 | — |
| typed Presentation/採用/再読込 | 済 | 済 | production loader | proposal済 | SSE/history済 | 済 | receipt/CAS | 済 | — |
| owner/revision/security | 済 | 済 | 済 | 境界検証 | 済 | 済 | CAS/idempotency | negative test | — |
| 30/90日と調査予算 | 済 | 測定対象 | 接続済 | bounded read | partial/continuation | research表示 | receipt | stress test | — |

自動testの成功はA/B層の証拠であり、C（実モデル＋合成Provider）またはD（実Provider＋実Browser＋Server保存）を代替しない。
`tests/fixtures/epic-537-final-eval/observations.json`はparser契約fixtureで、静的な成功値を実績へ昇格しない。
production-shaped製品scenarioは`epic-537-product-e2e.test.ts`が、独自`loadContext`を使わず本番の
`createConversationServerAgent`を通して原文末尾、検索Evidence、typed Presentation、明示採用、readback、局所replanを検査する。

## A01〜A04 状態

| ID | 実装 | fixture検証 | Live実測 | 本番有効化 | 現時点の判断 |
| --- | --- | --- | --- | --- | --- |
| A01 検索・候補発見 | Web/KB/Rerank共通contractとadapterは済 | Web＋合成候補、KB/Rerank境界test済 | — | Webのみ既存設定。KB/Rerankは設定時だけで未有効 | adapter存在を品質改善とは判定しない |
| A02 崩れにくさ | scenario差分、多軸比較、unknown保持は済 | delay/rain/closure等のDomain test済 | — | 公開presentation/UI接続済 | scenario pass率を実旅行成功確率へ変換しない |
| A03 調査予算 | standard/detailed、typed usage、partial/continuationをPR7で接続 | budget/stress fixtureをPR7で検証 | — | current Server Agent内のbounded実行。AgentCore全面移行なし | checkpoint/resumeの実運用効果は未測定 |
| A04 Prompt Cache | Bedrock cache point、usage/cache状態contractは済 | off/cold/warm/TTLのadapter test seam済 | — | default-off。production有効化未確認 | 総費用・latency非退行をLiveで測るまで有効化推薦なし |

## 最終Evalの実行層

| 層 | 構成 | このrevisionの状態 |
| --- | --- | --- |
| A | pure Domain（時間・日別・費用・制約・lineage） | owner別自動testは実行可能。統合report用execution artifactは未生成 |
| B | production composition＋合成repository/Provider/model | traceable製品E2E testあり。統合report用反復artifactは未生成 |
| C | 同composition＋実モデル＋合成Provider | 未実施 |
| D | 実Provider＋実Browser＋Server保存 | 未実施 |

Final Eval manifestはseed、clock、input、Provider/source版、推論設定、model ID、region、cache状態、料金表、
prompt/schema/tool版と構造before/after×current/upperの全4セルを必須とする。未測定セルは`not_measured`と`null`で表し、
0へ丸めない。Live比較は最低3反復を入口とするが、小標本のp95/成功率を精密な母集団推定として扱わない。
