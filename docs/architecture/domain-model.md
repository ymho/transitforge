# 標準データモデル

利用者の予約済・予約不要の自己申告は[予定の予約マーク](../specs/trip-booking-marks.md)を参照する。独立Reservationの仕様とは区別する。

型・validator・Application・Terraformを正本とし、この文書は保存先と所有境界への入口とする。
旧型の導入経緯は[Trip lifecycleのHistorical節](../specs/trip-model.md)と[ADR索引](../decisions/README.md)に残す。

## 正本と保存先

| モデル | 正本・保存先 | Browserの役割 |
| --- | --- | --- |
| TrainIndex / PathCatalog | data-builder生成のviewer-input。Domainは`modules/train/domain` | 入力Adapterと描画 |
| 遅延・混雑・運休 | data-builderの交通スナップショット。計算は`modules/operation/domain` | 完全性・鮮度を検証して表示 |
| JourneySearchRequest / JourneyRouteResult | `modules/journey/domain`の検索計算、Backendの日付別index | 候補表示。LLMもBrowserも経路を再計算しない |
| Conversation metadata / message / turn / working state | `/api/conversations/v1`とServer turn保存、owner-scoped DynamoDB server-state | HTTP読取、一覧・履歴・active selectionのメモリread model |
| UserProfile V3 | `/api/profile/v1`、同tableの`PROFILE_V3` | 3項目のCAS自動保存、失敗時のdraft保持 |
| Trip V2 / TripRequest / ItineraryItem | `/api/trips/v1`、owner-scoped DynamoDB trips | `conversation.tripId`を参照して取得。表示コピーは正本ではない |
| 候補 / Offering / Evidence / Reservation / Watch / Impact | 各Domain / Applicationの独立resource・観測 | 採用状態・予約・空室を混同せず投影 |
| JourneySearchPreferences | LocalStorage `transitforge.journey-search-preferences.v1` | 乗換ペース・順位の端末設定。今回条件の正本ではない |
| ContextWorkspaceState | LocalStorage `raiquora.context-workspaces.v1`、最大20会話の表示状態 | map / trip-plan / journey-detailsの表示対象。会話・Trip本文を含めない |
| 認証session | タブ単位sessionStorage | token・PKCE・絶対期限。業務データ保存と別境界 |

Conversation / Profile / TripをLocalStorageへ保存・復元するwriter、legacy migration、dual-write、障害時fallbackはない。
Profileや会話を変更・削除してもTripを暗黙更新・削除しない。
ContextWorkspaceの状態を保存するAdapterの存在と、現在の画面配置は分ける。専用旅程一覧・日別タイムラインが
現行UIであり、旧3ペイン配置を保存仕様から推定しない。[workspace](../specs/trip-workspace.md)を参照する。

## 時刻表・運行・検索

Trainは`service_uid`、Pathは`path_id`、運行スナップショットとの結合は`train_no`。
計画位置は`route_meter`で補間し、時刻計算は4時境界の業務日付と`route_time_minutes`を使う。
24時超の値と暦日を区別し、表示だけで日付を落とさない。
完全かつ新鮮な当日スナップショットに存在しない列車は運休として扱う。未取得の遅延・混雑を0へ補完しない。

`JourneySearchService`とCSA / 比較は`modules/journey/domain`が所有し、Server ToolがBackendの検索operationへ接続する。
Browserの残存`/api/agent` read clientと、相談用Server Toolの組成は別である。
入力形式は[Viewer入力](../data/viewer-input.md)、Tool登録は[Server Agent](agent-runtime.md)を参照する。

## Trip・Profile・会話

Tripは独立UUID、`schemaVersion: 2`、revision、request、planningState、lifecycleState、itemsを持つ。
Domain schema、wire `trip-api-v1`、DB storageVersion、編集revisionは別概念。
採用Snapshotには検証済みの予定値を保存し、現在の遅延・空室・予約事実は別resource / 観測で扱う。
原通貨を保持し、未知の料金・日付・タイムゾーンを作らない。

`UserProfile version: 3`は`usualOrigin` / `interests` / `considerations`と更新metadataだけ。
同行者・ペース・予算・AI同意field等の旧v2を読込・round-tripしない。旧recordの一括削除もしない。
ProfileはEffective Intentのreference-only soft hintで、今回の明示条件が優先する。[Profile V3](../specs/profile.md)を参照する。

Server Context Loaderは同ownerのTrip、Profile、直近最大12件のtext履歴とworking stateを復元する。
TripRequestと受理済み条件・仮定・Profile hintを分離し、本文から正本を再構築しない。
`TripContext`等の残る計算・表示用型をBrowserの永続正本や旧Runtimeと扱わない。
別会話へ自動的に好みを昇格するTravelMemory writerはない。

## Agentと表示契約

[ADR 0096](../decisions/0096-use-strands-for-agent-v2-execution.md)のStrands v2専用。
`modules/agent/runtime`はProvider非依存のContext / Tool / Evidence / Trace契約を、
`backend/agent-api/src/adapters/strands-agent-engine.ts`はSDK loopを所有する。
旧MultiStepAgentRuntime、旧Prompt・Semantic pre-loop、旧decision Live Evalは撤去済み。

`AssistantTurnView`へ本文・delivery・条件/保存receipt・publicカード・Proposalをallowlist投影する。
live SSE・履歴・replayを同じrendererへ渡し、raw Provider payload・内部推論・Traceは渡さない。
候補IDと公開参照をApplicationで解決して採用し、履歴描画で保存を再実行しない。

Trace / feedbackの過去の保存契約と残存schemaはproductionの送信口と区別する。
旧`/api/agent`のconversation / feedback / traceは410。現行Server診断は
`strands-runtime-diagnostics.ts` / `server-agent-diagnostics.ts`で機微情報を抑制する。
[Security / Privacy](security-privacy.md)と[旧ingress閉鎖](authentication.md)を参照する。

## 実装と検証への導線

| 境界 | 一次根拠（repository root相対） |
| --- | --- |
| Profile | `modules/trip/domain/travel-profile.ts`、`backend/agent-api/src/adapters/dynamodb-profile-repository.ts`と隣接test |
| Server復元 | `backend/agent-api/src/usecases/agent/server-state-context-loader.ts`と隣接test |
| 公開writer・CAS | `backend/agent-api/src/trip-api-composition.ts`、`trip-handler.ts`、`usecases/trip-application.ts`と隣接test |
| Browser例外 | `frontend/src/presentation/concierge/journey-preferences-storage.ts`、`frontend/src/adapters/browser/context-workspace-repository.ts` |
| 認証・route | `infra/terraform/environments/dev/cognito.tf` / `agent-stream.tf`、`backend/agent-api/src/adapters/api-route-policy.ts` |
| v2表示 | `frontend/src/domain/assistant-turn-view.ts`、`frontend/src/usecases/concierge/assistant-turn-projection.ts`と隣接test |

詳細は[Domain所有権](module-boundaries.md)、[Module境界](module-boundaries.md)、[Server state](server-state.md)、
[Trip保存](../specs/trip-persistence.md)、[テストガイド](../../tests/README.md)を参照する。

Tripには任意の[保存済み天気](../specs/trip-weather.md)を保持できる。予定ID・場所と日時のbasis・取得日時・有効期限を束ねた予報観測であり、リアルタイムの状態や安全性の判定ではない。
