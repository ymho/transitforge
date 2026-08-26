# 標準データモデル

この文書はRaiquoraが扱う主要なデータモデルの案内である。

型とスキーマの実装を正本とし この文書は責務 保存先 生成元 結合キーを説明する。型を変更するときは
対応する実装 テスト この文書を同時に見直す。ER図が必要な範囲だけ 将来`domain-model.dbml`を補助資料として追加する。

TypeScriptとPythonのどちらが計算の正本を持つかは[Domainの所有権](domain-ownership.md)を参照する。

## 境界

| 区分 | 役割 | 正本 |
| --- | --- | --- |
| 時刻表入力 | 列車 停車時刻 経路 駅 路線の計画データ | data-builder生成の`viewer-input` |
| リアルタイム入力 | 混雑 遅延 行き先変更 停車状態 | data-builder収集の交通スナップショット |
| 検索ドメイン | 入力をもとにした経路候補と制約 | `modules/`と移行中の`frontend/src/domain/` |
| 旅行相談 | 普段の好みと今回の条件 旅行候補 旅程 | `modules/trip/domain` |
| 会話状態 | セッション 履歴と端末内保存 | `frontend/src/domain/`とブラウザLocalStorage |
| AI応答 | UIへ返す経路 旅行 会話の構造化結果 | `frontend/src/domain/viewer-agent-response.ts` |
| フィードバック | 利用者が明示送信した会話と評価 | private S3 |
| Agent Trace | 上限付き実行eventと関連request ID | private S3 |

ブラウザの画面状態やMapbox Three.jsの描画オブジェクトはドメインモデルではない。AWS認証情報
外部提供者の秘密値 現在地座標もこのモデルへ含めない。

## 時刻表と運行

### `TrainIndex` `Train` `TrainStop`

- Domain契約: `modules/train/domain/train.ts`
- 入力Adapter: `frontend/src/adapters/http/viewer-input/train-index.ts`
- 保存先: `viewer-input/train_index.json`
- 生成元: transitforge-data-builder
- 用途: 列車表示 経路検索 駅と路線のカタログ

`Train`は営業日内の列車を表す。識別子は`service_uid`であり `train_no`は遅延 混雑との結合と
表示に使う。停車時刻は`TrainStop`で保持し 時刻計算には`route_time_minutes`を使う。

### `PathCatalog`

- Domain契約: `modules/train/domain/path.ts`
- 入力Adapter: `frontend/src/adapters/http/viewer-input/path-catalog.ts`
- JSON契約: `docs/data/viewer-input.md`
- 保存先: `viewer-input/path_catalog.json`
- 結合キー: `Train.path_id` → `PathCatalog.paths[].path_id`

経路は列車と分離して座標列として保持する。同じ線路を走る列車は同じ`path_id`を参照できる。

### `TrainDelaySnapshot` `TrainOperation`

- Domain契約: `modules/operation/domain/operation.ts`
- 状態適用: `modules/operation/domain/train-operation-state.ts`
- 入力Adapter: `frontend/src/adapters/http/traffic/train-delay.ts`
- 保存先: `/api/traffic/delays.json`
- 結合キー: `Train.train_no` → `operationsByTrainNumber`

`TrainOperation.destination`は当日の行き先の正本である。スナップショットが完全かつ新鮮なときだけ
デジタルツイン表示へ適用する。スナップショットに存在しない列車は運休として扱う。

### `TrainCongestionSnapshot`

- Domain契約: `modules/operation/domain/operation.ts`
- 入力Adapter: `frontend/src/adapters/http/traffic/train-congestion.ts`
- 保存先: `/api/traffic/congestion.json`
- 結合キー: 列車番号

車両ごとの混雑値はブラウザで列車単位に集約して描画する。混雑はリアルタイムの補助情報であり
時刻表や経路検索の正本ではない。

詳細なJSONスキーマと時刻の表現は[ビューワー入力仕様](../data/viewer-input.md)を参照する。

### 駅名と業務時刻の値表現

- 駅名比較の正本: `modules/train/domain/station-name.ts`
- 経路時刻表示の正本: `modules/train/domain/route-time.ts`

入力に含まれる駅名表記は保持し 比較と索引を作るときだけNFKC 空白 末尾の`駅`と
`ヶ` `ケ`の表記揺れを正規化する。画面用の駅名を比較用の値で上書きしない。

`route_time_minutes`は4時を境界にした業務日付内の値であり 24時以降を許容する。
時刻表は`24:20`のように業務時刻を維持し 経路カードや会話上の時計時刻は`00:20`のように
翌日の時計へ折り返す。呼び出し元で剰余計算を再実装せず 用途に合う共通関数を選ぶ。

## 経路検索

### `JourneyRouteLeg` `JourneyRouteResult`

- 定義: `modules/journey/domain/direct-route-search.ts`
- 生成元: 日付別接続インデックスを使う経路検索

`JourneyRouteLeg`は1列車で移動する区間 `JourneyRouteResult`は複数区間を含む候補である。
区間には予定時刻と 適用可能な場合だけ実測または推定の遅延を含める。乗換は独立した列車ではなく
隣り合う区間の駅と時刻差から表現する。

### `DirectRouteSearchResponse`

- 定義: `modules/journey/domain/direct-route-search.ts`
- 境界: ブラウザからAI Lambdaへの経路検索結果

検索条件と候補を1つにまとめる応答である。日付 `departureDate`と業務日付 `serviceDate`は別の値として
保持する。除外 必須 種別限定の条件は検索後の表示処理ではなく検索契約として保持する。

### `JourneySearchService` `search_journeys`

- ドメイン契約: `modules/journey/domain/journey-search-service.ts`
- Agent Adapter: `frontend/src/usecases/agent/search-journeys-tool.ts`
- 現在の実装: `/api/agent`の`journey_search`を呼ぶHTTP client

`JourneySearchService`は`modules/journey`のCSAや直通インデックス実装を利用側から隠し 日付 乗換上限
乗換ペース 順位条件 列車の除外と必須条件を構造化して渡す。`search_journeys`はこのServiceを
呼ぶ薄いAdapterであり 経路や順位をLLMで再計算しない。

決定論的なCSAと直通検索は`services/agent-api/domain/journey`が所有する。
Browserとのwire形式は`journey-search-v1`を明示し Node Backendと移行中のPython互換実装でversionを検証する。
Providerに依存しない旅行候補モデルと費用集計は`services/agent-api/domain/travel`が所有する。

Agentへ返す候補は最大3件 直列化後64KiBまでに制限する。予定時刻 遅延適用後の時刻
遅延の観測または推定区分 制約結果はService応答を変更せず保持する。

### `NetworkInspectionService`

- ドメイン実装: `frontend/src/domain/network-inspection-service.ts`
- Agent Adapter: `frontend/src/usecases/agent/network-inspection-tools.ts`
- 入力: `TrainIndex`と`StationLineCatalog`

列車 駅 1列車内の経路詳細を読み取り専用で照会する。`inspect_train`はserviceUidが完全一致する
列車の概要だけを返し 全停車駅は含めない。`inspect_station`は共通駅名正規化による完全一致だけを
採用し 前方一致候補が複数ある入力を曖昧な駅として拒否する。LLMや外部APIによる駅名補正は行わない。

`get_route_details`はserviceUidと任意の発着駅で検証した区間を返す。停車記録は1回20件まで
ページングし 3つのToolはいずれも直列化後48KiBを上限とする。応答には取得できる場合だけ
業務日付 代表ダイヤ区分 カタログの生成元を含める。

### 運行分析Tool

- Adapter: `frontend/src/usecases/agent/operational-analysis-tools.ts`
- 既存集計: `services/agent-api/delay_analysis.py`
  `services/agent-api/congestion_analysis.py`
- 列車メタデータ結合: `frontend/src/domain/delay-analysis.ts`
  `frontend/src/domain/congestion-analysis.ts`

`analyze_delay`と`analyze_congestion`は4時切替の業務日付を受け取り DynamoDBの
operating day summaryをPythonで決定論的に集計した結果を利用する。Adapterで集計式を
再実装せず 時刻表との結合 入力検証 出力制限だけを担当する。

応答には観測期間 sample countと`operating-day-summary`のsource metadataを付ける。
sample countが0の場合は`observationStatus: unobserved`とし 未観測値を0で補完しない。
ランキングは既存境界どおり上位5件に限定し Tool応答は直列化後48KiBを上限とする。

### `compare_journeys`

- 比較ロジック: `modules/journey/domain/journey-comparison-service.ts`
- Agent Adapter: `frontend/src/usecases/agent/compare-journeys-tool.ts`

同一Agent実行内で`search_journeys`が検証した検索結果だけをIDで解決し 最大3候補を比較する。
モデルから経路本体を入力させず 存在しない検索結果IDや候補番号を拒否するため 比較処理が新しい経路を
推測または生成することはない。

比較値は発着時刻 所要時間 乗換数 各列車へ適用した遅延 明示制約の充足状態とする。
最早到着 最遅出発 最短時間 最少乗換 最少遅延などの理由は列挙値で返し 同じ入力では常に
同じ候補と理由を返す。運賃 空席 景色や旅行の主観的魅力度は比較しない。

`search_journeys`と`compare_journeys`を同じAgent実行で使う場合は
`VerifiedJourneySearchResultStore`へ検索結果をboundedに保持する。Tool応答にはopaqueな
`searchResultId`を含め 比較Toolは同じ`executionId`で保存された結果だけを解決する。
processをまたぐ永続状態や会話履歴としては扱わない。

### EvidenceとGrounded Claim

- モデル: `frontend/src/usecases/agent/evidence-model.ts`
- Tool結果変換: `frontend/src/usecases/agent/tool-result-evidence.ts`

Evidenceは`deterministic_fact` `derived_value` `model_interpretation`
`unverified_information`を区別する。情報源は`sourceType` `sourceRef` `retrievedAt`
`freshness` `summary`を持ち 時刻表 経路 列車 駅 遅延 混雑 比較結果から共通形式へ変換する。

事実Claimは1件以上の存在するEvidence IDを必要とする。参照がない または存在しないIDを参照する
事実Claimは`unsupported`として検出する。情報不足はEvidenceを捏造せず`unknown` Claimとして表す。
Grounding判定はモデルの自己申告ではなく`validateEvidenceAndClaims`が決定論的に行う。

Grounded End-to-Endフローでは最終応答を本文 Claim Viewer Actionへ構造化する。
Runtimeは全Claimを検証し unsupportedな事実が1件でもあれば本文を安全側の失敗応答へ置き換え
Viewer Actionを実行しない。Grounding成功後のActionだけを同じ実行で収集したEvidenceから作る
task scopeへ渡す。判断記録は[ADR 0026](../decisions/0026-ground-agent-responses-before-viewer-actions.md)を参照する。

### Structured Agent Trace

- モデルとRecorder: `frontend/src/usecases/agent/agent-trace.ts`

1回のAgent実行は`executionId`に紐づく順序付きeventとして記録する。eventは利用者の依頼
正規化した意図 plan Tool呼び出しと結果 Evidence 再計画判断 モデルmetadata 応答
Viewer Actionと完了状態を区別する。これにより会話文や巨大なTool結果を丸ごと保存せず
後続のRuntimeとEvaluationが同じ実行過程を再現できる。

Recorderは既定200件で追記を停止し 超過件数を`droppedEventCount`へ記録する。
payloadは件数 深さ 文字数を制限して要約し 秘密値 Authorization cookie
現在地の緯度経度を記録前に除去する。Tool errorのcodeと再試行可否 Viewer Actionの
拒否理由は残すが 例外そのものやProviderへ送った未加工payloadは残さない。
通常のTraceは実行中のメモリだけに保持し 自動的な全量保存と分析UIは対象外とする。

評価と不具合調査へ利用するTraceだけは`agent_trace` operationで明示送信できる。
Lambdaが同じschemaと秘匿情報除去を再検証してからprivate S3へ30日間保存する。

### Multi-step Agent Runtime

- Runtime: `frontend/src/usecases/agent/agent-runtime.ts`
- 契約: `frontend/src/usecases/agent/runtime-contract.ts`
- 制限: `frontend/src/usecases/agent/runtime-policies.ts`
- 判断記録: [ADR 0023](../decisions/0023-build-bounded-multi-step-agent-runtime.md)

Problem Framing Planner Tool RegistryとExecutor Evidence Responseを別責務として接続する。
RuntimeはProvider固有形式を扱わず 既定で反復4回 model call 5回 Tool 8回
実行15秒 Evidence 20件を上限とする。複数Toolは順番に実行し 結果をTool call IDで
次のmodel callへ返す。不足情報がある場合はToolを実行せずfollow-upを返す。

導入中は機能単位の`AgentRuntimeRolloutRouter`で比較した。現在の本番モデル実行は
`MultiStepAgentRuntime`へ一本化し Bedrock AdapterはProvider DTOとTool Adapterを組成する。
Toolが提案したViewer Actionも共通Runtime内でEvidence scopeを検証してから適用する。
判断記録は[ADR 0034](../decisions/0034-use-one-production-agent-runtime.md)を参照する。

最初のE2Eシナリオは当日遅延を含む経路検索から候補比較を行い Evidence付き回答と
検証済み経路の強調 Evidence表示までをoffline fixtureで通す。ProviderやS3へ接続せず
Tool順序 ClaimのGrounding Viewer Actionのtask scopeとTraceを同じテストで確認する。

### Viewer Action Policy

- Action契約: `frontend/src/usecases/viewer/viewer-action.ts`
- task scopeとPolicy: `frontend/src/usecases/viewer/viewer-action-policy.ts`
- Executor: `frontend/src/usecases/viewer/viewer-action-executor.ts`
- 判断記録: [ADR 0024](../decisions/0024-restrict-viewer-actions-to-task-scope.md)

Agentが提案できる操作を`focus_train` `highlight_route` `set_display_time`
`compare_journeys` `show_evidence`などの列挙型へ限定する。列車 経路 Evidenceを対象にする
操作は同じ`executionId`のTool結果からApplicationがtask scopeへ登録したEntityだけを許可する。
時刻は生成済みダイヤの最大時刻以内とし 未知Action 余分なfield 別taskのEntityをPort実行前に拒否する。

ExecutorはDOMやMapboxを直接参照せず表示用Portだけを呼び出す。操作は可逆な表示設定または
表示だけの効果に限定し 提案 適用 拒否をTraceへ記録する。従来`main.ts`にあった時刻Actionの
解釈と実行もExecutorへ移し Viewer起動処理にはPortの接続だけを残す。

### Agent Evaluation

- 契約: `frontend/src/usecases/agent/evaluation/evaluation-contract.ts`
- 判定: `frontend/src/usecases/agent/evaluation/agent-evaluator.ts`
- dataset: `tests/fixtures/agent-eval-cases.json`
- 判断記録: [ADR 0027](../decisions/0027-evaluate-agent-quality-with-objective-metrics.md)

version付きdatasetとProvider非依存のobservationを入力し Tool選択 制約充足 Grounded Claim
Unsupported Claim Task完了 Viewer Actionの6指標をコードで判定する。Runtime結果は
Structured Trace Claim Viewer Actionからobservationへ正規化する。35ケースのうち経路fixtureを
利用できるものは既存の
journey search scenario IDを参照し 鉄道fixtureを重複定義しない。

reportは機械処理用JSONとレビュー用Markdownを同じ結果から生成する。
datasetにないobservationや不足するobservationは失敗として扱い 評価対象の取り違えを隠さない。
曖昧要求 運休 遅延 制約 情報不足 複数Tool Viewer Actionを固定カテゴリとして
全6指標をJSONとMarkdownへ出す。事実Claimが存在しない情報不足カテゴリではGroundedと
Unsupportedを`N/A`とし 0件を成功率100%として偽装しない。

runnerの`--case`はcase IDでdatasetとobservationを同時に1件へ絞り込む。
存在しないIDは全件実行へフォールバックせず明示的に失敗する。

### Re-planとReflectionの戦略実験

- 実験契約: `frontend/src/usecases/agent/evaluation/strategy-experiment.ts`
- fixture: `tests/fixtures/agent-strategy-experiment.json`
- 判断記録: [ADR 0031](../decisions/0031-retain-result-driven-replan-without-always-on-reflection.md)

35件Benchmarkから回復可能な失敗と成功controlを含む8件を固定し single pass
結果駆動再計画 常時ReflectionのON/OFF比較を再現する。各戦略は同じEvaluation Frameworkで
品質を判定し model call Tool call latency tokenを別に集計する。

latencyとtokenは固定Provider相当の決定論的コストモデルによる相対値で AWS料金ではない。
結果駆動再計画は品質改善が確認できたため既存Runtimeで維持する。常時Reflectionは追加改善がなく
相対コストだけが増えたため本番Runtimeへ追加しない。

Evaluation profileは`smoke`と`full`を持つ。Smokeはtagで選んだ軽量集合 Fullは全datasetを使う。
run reportは6指標の実測値 閾値 判定とcase結果を含み case失敗または閾値未達で失敗する。
CI分離の判断は[ADR 0029](../decisions/0029-separate-smoke-and-full-agent-evaluation.md)を参照する。

### Read-only MCP Adapter

- 共通Registry: `frontend/src/usecases/agent/readonly-transit-tool-registry.ts`
- Protocol Adapter: `frontend/src/adapters/mcp/readonly-transit-mcp.ts`
- stdio transport: `frontend/src/adapters/mcp/stdio.ts`
- 判断記録: [ADR 0030](../decisions/0030-expose-read-only-domain-tools-through-mcp.md)

MCPはDomain Serviceを外部Agentへ公開するProtocol Adapterであり 鉄道ロジックを持たない。
内部Agentと同じTool Registryから`search_journeys` `inspect_train` `inspect_station`
`analyze_delay` `analyze_congestion`だけを公開する。Tool Contractの入力SchemaをMCP用Schemaへ
変換した後も 各Toolの`parseInput`を正本として検証する。

Viewer Action `get_route_details` 書き込み操作は公開しない。stdio serverは具体的な
Domain Serviceを注入済みのRegistryをComposition Rootから受け取る。remote transport 認証
公開デプロイはこのAdapterの責務に含めない。

### `JourneySearchPreferences`

- 定義: `modules/journey/domain/journey-search-preferences.ts`
- 保存先: ブラウザLocalStorage

乗換ペース 経路優先 最大乗換回数を表す。これは検索時の好みであり 旅行プロフィールには含めない。

## 旅行相談

### `UserProfile`

- 定義: `modules/trip/domain/travel-profile.ts`
- Repository: `frontend/src/usecases/trip-profile/user-profile-repository.ts`
- 保存先: LocalStorage `transitforge.travel-profile.v2`
- 更新元: 初回オンボーディングとプロフィール編集

普段の出発地 同行者 好み 旅行ペース 許容移動時間を表す。個人を直接特定する情報や子どもの
生年月日は保存しない。コンシェルジュの選定と将来の旅行推薦に使う。
旅行検索で出発駅が明示されていないときは`home.station`を普段の出発駅として使う。

### `TripContext`

- 定義: `modules/trip/domain/travel-profile.ts`
- 保持範囲: 現在の旅行相談

今回の行き先 希望日 興味 同行者 移動条件などを表す。一回限りの「海に行きたい」はここへ入り
普段の「山が好き」は`UserProfile`へ入る。両者を混在させない。

### `ConversationGuidance` `ConversationSubmission`

- 定義: `frontend/src/domain/conversation-guidance.ts`
- 生成元: Bedrockの`ask_follow_up`ツール

`ConversationGuidance`は次の質問 質問の種類 クイックリプライ `TripContext`を持つ。
UIはこの契約を共通入力として描画するだけで 会話パターンごとの日付入力や宿泊数入力を持たない。
`ConversationSubmission`は利用者の回答と直前のガイダンスを結び 次のAI呼び出しへ渡す。

### `ConversationHistoryEntry`

- 定義: `frontend/src/domain/conversation-history.ts`
- 保存先: LocalStorage `transitforge.concierge-history.v2`

コンシェルジュ画面に表示した利用者の発話と構造化されたAI応答を会話セッションごとに最大50件保存する。
再読み込み後も表示を復元し 同じセッションの直近3件だけを短いテキストへ変換してBedrockの文脈に使う。
別の相談の全履歴を無条件に混ぜない。
AI応答には取得できた`x-transitforge-request-id`も保存し 再読み込み後の明示的なフィードバックへ紐付ける。

### `ConversationSession` `TravelMemory`

- 定義: `frontend/src/domain/conversation-session.ts`
- Repository Port: `frontend/src/usecases/concierge/conversation-session-repository.ts`
- Browser Adapter: `frontend/src/adapters/browser/conversation-session-repository.ts`
- 保存先: LocalStorage `transitforge.conversation-sessions.v3` `transitforge.travel-memories.v1`

`ConversationSession`はUUIDで相談を識別し 現在の対象を`general` `trip` `place` `route`のスコープで表す。
表示タイトル 短い要約 確認済みの話題 未確認の話題と 関連する`TripPlan.id`を持つ。
Repositoryは作成 選択 改名 削除を提供し 最終更新が新しい20セッションを端末内に保持する。
上限超過または明示削除時は同じUUIDの会話履歴と旅程も削除する。v2のUUIDと要約はv3へ一度だけ移行する。
会話履歴画面はRepositoryのactive UUIDだけを変更し 選択後に同じUUIDのメッセージ 旅程 AI文脈を再構成する。
新しい会話は履歴も旅程もないUUIDとして作り 最初の依頼を端末内の表示タイトルに使う。

`TravelMemory`は会話から得た継続的な好みである。一回限りの`TripContext`と分離し 高確度の記憶だけを
別セッションのAI文脈へ渡す。現在の明示的な依頼と`UserProfile`を上書きしない。

### `TripPlan` `TripPlanItem` `TripPlanPatch`

- 定義: `modules/trip/domain/trip-plan.ts`
- Repository: `frontend/src/usecases/trip-plan/trip-plan-repository.ts`
- 保存先: LocalStorage `transitforge.trip-plans.v2`

1つの`ConversationSession.id`に対して編集対象の`TripPlan`は1つだけ保持する。別の旅行は新しい会話
セッションとして分離する。同じ旅行の変更案やタイトル再生成は旅程を増やさず 現在の旅程への
`TripPlanPatch`として扱う。旧キー`transitforge.trip-plan.v1`の単一旅程は現在の会話へ一度だけ移行する。

編集可能な旅程は`movement` `stay` `sightseeing`の3種類だけで構成する。`movement`は鉄道経路のほか
レンタカー 車 バス 徒歩を表現できる。鉄道区間は検索済みの`ViewerAgentJourneyPlan`を保持し
検索結果のない所要時間や予約情報を補完しない。

`TripPlanConditions`は今回の旅行だけに適用する大人人数 子どもの人数 最大8件の考慮事項を持つ。
普段の同行者や好みを表す`UserProfile`とは分離し 旅程のメタデータ変更として確認後に保存する。

画面では各項目を独立したカードとして表示する。鉄道移動は保持している経路から発着時刻 列車
行き先 路線 乗換待ち時間 遅延を描画し 自由文から経路情報を補完しない。
カードの開閉状態とカード間の追加導線は画面状態であり`TripPlan`へ保存しない。追加導線は前後の
`TripPlanItem`を自然文の相談へ変換し AIが提案した`TripPlanPatch`だけを確認後に反映する。

既存旅程の変更は`TripPlanPatch`の追加 置換 削除 並べ替え メタデータ変更として提案する。
AI応答だけでは保存せず 利用者が画面で反映を選んだ後に適用する。日程と鉄道経路の変更は
自由文から組み立てず 宿泊検索と経路検索の構造化結果からパッチを生成する。
タイトル再生成は現在の移動 滞在 観光をAIへ渡し 行程を変えず`metadata.title`だけを提案する。

## AIと旅行候補の応答

### `TravelCandidate` `TravelExpenseSummary`

- 定義: `modules/trip/domain/travel-candidate.ts`

鉄道経路へ宿泊と体験を組み合わせるProvider非依存の候補である。費用はJPYの既知価格だけを合計し
価格がない項目は`hasUnpricedItems`で明示する。鉄道運賃は取得も推定もせず常に集計対象外とする。

### `ViewerAgentJourneyPlan`

- 定義: `modules/trip/domain/travel-plan.ts`
- Viewer応答alias: `frontend/src/domain/viewer-agent-response.ts`
- 内容: 検索条件と`JourneyRouteResult[]`

AI応答からUIへ渡す経路表示用モデルである。`JourneyRouteResult`をそのまま再解釈せず タブと
タイムラインへ描画する。

### `ViewerAgentTravelPlan`

- 定義: `modules/trip/domain/travel-plan.ts`
- Viewer応答alias: `frontend/src/domain/viewer-agent-response.ts`
- 内容: 行きの経路 帰りの経路 宿泊候補

旅行の鉄道運賃は含めない。宿泊候補の空室と日付別料金は正本データがない限り保持も表示もしない。

### `ViewerAgentResponse`

- 定義: `frontend/src/domain/viewer-agent-response.ts`

AIからUIへ返す合併型である。文字列 経路 `ViewerAgentJourneyPlan` 旅行 `ViewerAgentTravelPlan`
追加質問 `ConversationGuidance` 旅程変更 `TripPlanUpdateProposal`のいずれかを返す。
AIの自由文をUIの状態遷移に使わない。

## 明示的なフィードバック

### `conversation-feedback-v1`

- 定義: `services/agent-api/conversation_feedback.py`
- 保存先: private S3 `conversation-feedback/YYYY/MM/DD/<feedbackId>.json`
- 保持期間: 90日
- 暗号化: S3管理キーによるサーバー側暗号化 `AES256`
- 内容: `schemaVersion` `feedbackId` `createdAt` 評価 `rating`
  会話 `conversation` APIリクエストID `requestIds`

`rating`は`good | bad` 会話は`user | assistant`の1〜50件 各本文は1〜4000文字とする。
`requestIds`は最大50件 各IDは1〜128文字とする。保存失敗は成功として扱わず
request ID付き503と本文を含まない構造化ログを返す。

### `conversation-feedback-v2`

- TypeScript定義: `frontend/src/usecases/concierge/conversation-feedback.ts`
- Server検証: `services/agent-api/conversation_feedback.py`
- 追加項目: `sessionId` `targetMessageId` 任意の`comment` 各会話の`messageId`

画面のDOMから本文を再構成せず Conversation History Repositoryに保存された会話の先頭から
評価対象の回答までを送る。対象回答より後の会話は含めない。Bad評価だけ1000文字以内の任意コメントを
付けられる。保存前にメッセージIDの一意性 対象回答が末尾のassistantであること
会話内request IDと`requestIds`の対応を検証する。256KiBを超える場合は黙って欠落させず413を返す。
v1入力は既存クライアントとの互換用に引き続き受け付ける。
Goodは1操作で送信し Badだけ対象回答の直下でコメント付き コメントなし キャンセルを選べる。
送信中は二重操作を無効化し 成功または再試行可能な失敗状態を読み上げ可能なstatusとして表示する。

利用者が👍または👎を押したときだけ保存する。会話分析やIssue化は別の処理として扱い 本モデルは
画面表示とAIプロンプトへ自動再投入しない。

## Agent Trace保存

### `agent-trace-submission-v1`

- TypeScript定義: `frontend/src/usecases/agent/agent-trace.ts`
- Server検証: `services/agent-api/agent_trace_storage.py`
- 保存先: private S3 `agent-traces/YYYY/MM/DD/<taskId>/<traceId>.json`
- 保持期間: 30日
- 判断記録: [ADR 0025](../decisions/0025-store-bounded-agent-traces-privately.md)

`taskId` `executionId` 関連するAPI `requestIds`と最大100件のeventを保存する。
本文は24KiBを上限とし Lambdaでevent schema 順序 field型を再検証する。
秘密値 Authorization cookieと現在地座標はブラウザ側のRecorderに加え
保存直前にも除去する。生のTool payload 会話全文 例外詳細は保存しない。
S3書込失敗は成功として扱わず request ID付き503と構造化ログを返す。

## 変更時の確認

1. 型またはスキーマの正本を変更する
2. 境界をまたぐ変換とバリデーションを更新する
3. 該当するTypeScriptまたはPythonテストを追加する
4. この文書と`docs/data/viewer-input.md`の記述を見直す
