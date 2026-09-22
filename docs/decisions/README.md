# アーキテクチャ判断記録

このディレクトリは重要な技術判断と当時の前提を記録する
現在の利用方法はREADMEと各仕様書を正とし ADRは判断の履歴として読む

## 状態

- Proposed 提案中
- Accepted 採用
- Superseded 後続ADRで置換
- Rejected 不採用

## 追加手順

1. `0000-template.md`をコピー
2. 連番を付ける
3. 背景 選択肢 判断 影響を記録
4. 置き換えるADRがあれば明記

番号は既存ファイルと重複させない。欠番は過去の判断整理によるもので再利用しない

## 索引

- [0066 対応範囲を読込済み時刻表とアクセス根拠から導く](0066-derive-service-coverage-from-loaded-timetables.md)
- [0065 Trip共有を独立したParticipant/Grantで認可する](0065-authorize-trip-sharing-with-independent-resources.md)
- [0064 旅行中の事実をbounded read contextへ投影する](0064-bound-in-trip-read-context.md)
- [0001 Webベースの3D可視化にMapboxを使用する](0001-use-mapbox-for-web-3d-visualisation.md)
- [0002 初期WebビューワーにViteとTypeScriptを使用する](0002-use-vite-and-typescript-for-the-initial-web-viewer.md)
- [0003 開発時にローカルのビューワー入力を配信する](0003-serve-local-viewer-input-in-development.md)
- [0004 国土数値情報から駅・路線カタログをローカル生成する](0004-generate-station-line-catalog.md)
- [0006 AWSへTerraformでデプロイしAI基盤にAmazon Bedrockを使用する](0006-deploy-to-aws-with-terraform-and-bedrock.md)
- [0007 Bedrockへ渡す前に混雑時系列を決定的に集計する](0007-aggregate-congestion-before-bedrock.md)
- [0009 viewer-inputを日次ECSタスクで生成してS3へ公開する](0009-build-and-publish-viewer-input-with-a-daily-ecs-task.md)
- [0010 日次入力を4時に切り替え代表ダイヤだけをAI用に保持する](0010-stage-daily-input-and-retain-representative-timetables.md)
- [0011 旅行計画を3レイヤに分離し直通列車を自前データで確定する](0011-use-three-layer-travel-planning.md)
- [0012 Cloudflare AOPとCloudFront viewer mTLSで配信入口を保護する](0012-protect-cloudfront-with-cloudflare-aop.md)
- [0013 外部交通データの収集をprivate境界に置く](0013-keep-traffic-collection-private.md)
- [0014 最新運行スナップショットを現在表示の正本にする](0014-use-live-operation-snapshot-as-current-source-of-truth.md)
- [0015 直通列車インデックスで乗換1回まで探索する](0015-use-direct-service-index-for-one-transfer-search.md)
- [0016 経路検索の日付を暦日で受け取り現在検索だけ運行情報を適用する](0016-use-calendar-dates-and-current-snapshot-for-journey-search.md)
- [0017 複数乗換検索に多目的CSAを使う](0017-use-multi-criteria-csa-for-journey-search.md)
- [0018 鉄道経路を正本にし鉄道運賃を除外した旅行候補を組み立てる](0018-model-travel-candidates-without-rail-fares.md)
- [0019 外部旅行提供者への固定出口にNATインスタンスとElastic IPを使う](0019-use-nat-instance-for-private-provider-egress.md)
- [0020 外部旅行提供者の認証情報をSecrets Managerへ保存する](0020-store-provider-credentials-in-secrets-manager.md)
- [0021 AgentとDomain Logicの間に共通Tool境界を置く](0021-establish-agent-tool-boundary.md)
- [0022 AI Provider固有形式をAdapterへ隔離する](0022-isolate-ai-provider-contract.md)
- [0023 boundedなMulti-step Agent Runtimeを段階導入する](0023-build-bounded-multi-step-agent-runtime.md)
- [0024 Viewer Actionを同一Agentタスクの検証済みEntityへ限定する](0024-restrict-viewer-actions-to-task-scope.md)
- [0025 boundedなAgent Traceを非公開S3へ短期保存する](0025-store-bounded-agent-traces-privately.md)
- [0026 Agent応答をGroundingしてからViewer Actionを実行する](0026-ground-agent-responses-before-viewer-actions.md)
- [0027 Agent品質を客観指標中心のdatasetで評価する](0027-evaluate-agent-quality-with-objective-metrics.md)
- [0028 CIと継続的デプロイを別Workflowへ分離する](0028-separate-ci-from-continuous-deployment.md)
- [0029 Agent EvaluationをSmokeとFullへ分離する](0029-separate-smoke-and-full-agent-evaluation.md)
- [0030 読み取り専用Domain ToolをMCP Adapterから公開する](0030-expose-read-only-domain-tools-through-mcp.md)
- [0031 結果駆動再計画を維持し常時Reflectionは採用しない](0031-retain-result-driven-replan-without-always-on-reflection.md)
- [0032 Domainが中核契約を所有する](0032-let-domain-own-core-contracts.md)
- [0033 AgentのオーケストレーションをApplicationへ置く](0033-place-agent-orchestration-in-application.md)
- [0034 Viewer UIをFeature単位で配置する](0034-organize-viewer-ui-by-feature.md)
- [0035 旅行プロフィールを端末内へ保存する](0035-store-travel-profile-locally.md)
- [0036 Domain Logicを実行境界ごとに一意に所有する](0036-own-domain-logic-by-execution-boundary.md)
- [0037 TypeScript workspaceと共有Domain moduleへ段階移行する](0037-adopt-typescript-workspaces-and-shared-domain-modules.md)
- [0038 本番Agent実行を共通Runtimeへ一本化する](0038-use-one-production-agent-runtime.md)
- [0039 Amadeus Self-Serviceで航空便候補を検索する（廃止）](0039-use-amadeus-self-service-for-flight-offers.md)
- [0040 Open-MeteoとWikimediaで旅行文脈を補う](0040-use-open-meteo-and-wikimedia-for-travel-context.md)
- [0041 Mapbox POIを観光地点の正本にする](0041-use-mapbox-poi-as-place-identity.md)
- [0042 Web検索とページ読解をboundedなToolへ分離する](0042-use-bounded-web-research-tools.md)
- [0043 防災 駅から先の移動 食事を独立した旅行Toolにする](0043-use-official-safety-mapbox-access-and-restaurant-tools.md)
- [0044 BedrockをAgentの意思決定主体にする](0044-make-bedrock-the-agent-decision-authority.md)
- [0045 Tool公開を業務ケースではなく能力の利用可能性で決める](0045-expose-tools-by-capability-availability.md)
- [0046 内部思考ではなくboundedなAgent Decision Summaryを記録する](0046-record-bounded-agent-decision-summaries.md)
- [0047 provider非依存のmodel routingを同一Benchmarkで評価してから本番化する](0047-evaluate-provider-independent-model-routing-before-production.md)
- [0048 構造化されたAgent phaseだけをdecision modelへ送る](0048-route-structured-agent-phases-to-decision-model.md)
- [0049 AIによる直接Viewer操作を一旦停止する](0049-pause-direct-ai-viewer-operations.md)
- [0050 観光写真をWeb画像検索で補う](0050-use-web-image-search-for-place-photos.md)
- [0051 コンシェルジュのキャラクター機能を廃止する](0051-retire-concierge-personas.md)
- [0052 Trip V2の正本契約と段階migrationを確定する](0052-establish-trip-v2-contract-and-migration.md)
- [0053 owner-scoped Trip保存を認証・writer gateの内側に導入する](0053-gate-owner-scoped-trip-persistence.md)
- [0054 Trip mutationをrevision CASとreceiptで原子的に保存する](0054-commit-trip-mutations-atomically.md)
- [0055 ReservationをTripから独立した予約resourceにする](0055-separate-reservation-resource.md)
- [0056 採用済みTripの成立性を派生評価しready確定を検証する](0056-evaluate-adopted-trip-feasibility.md)
- [0057 派生Readinessと独立した旅行前準備を分離する](0057-separate-readiness-and-preparation.md)
- [0058 Tripの計画と監視・外部イベント・影響を分離する](0058-separate-trip-monitoring-resources.md)
- [0059 Trip変更をtransactional outboxでWatchへ届ける](0059-deliver-trip-changes-with-a-transactional-outbox.md)
- [0060 内部subject逆引きで鉄道観測をTripImpactへ評価する](0060-evaluate-rail-impact-through-internal-subject-routing.md)
- [0061 共通subject routingで天気・警報のTrip暴露を評価する](0061-evaluate-weather-hazard-impact-with-shared-routing.md)
- [0062 共有due-workでTrip再チェックを起動する](0062-schedule-trip-rechecks-with-shared-durable-due-work.md)
- [0063 Impactから通知episodeと配信を分離する](0063-separate-notification-episodes-and-delivery.md)
- [0067 Cognito検証を共通trusted principal境界へ閉じる](0067-establish-trusted-principal-boundary.md)

- [0069 SPA認証をCognito Managed LoginとPKCEへ接続する](0069-use-cognito-managed-login-for-spa.md)

## Wave 2Aによる部分廃止（#477）

0023のrollout router、0024のViewer Action、0026のAction実行、0038のAction/Local Agent、
0049の契約温存をretired/Supersededとした。0027のViewer Action採点も廃止した。
各ADR冒頭に廃止範囲を記し、過去本文と有効なGrounding・Evidence・bounded loopの判断は保持する。
Server Runtime・Stateの新構成は#478以降で決定する。

- [ADR 0068: Agent Runtimeの実行責務をServer Applicationへ移す](0068-place-agent-runtime-in-server-application.md) — ADR 0038のBrowser組成を置換。bounded loop/Groundingは維持し、Server AgentがCurrentである。

- [ADR 0070: Server Agentの通信にRegional REST progress streamingを採用する](0070-select-regional-rest-agent-streaming.md) — Server AgentのCurrent transport。導入時の検証記録はHistoricalとして保持する。

- [ADR 0071: 固定送信元IPが必要な宿泊Provider通信を専用Lambdaへ分離する](0071-isolate-fixed-egress-provider.md) — #480 Phase B。default-offで追加し、既存NAT/EIPを維持する。

- [ADR 0072: 実会話比較後も現行Agent model routingを維持する](0072-retain-current-agent-model-routing-after-live-comparison.md) — #474の3ケース×3反復比較ではSonnet 4.6へ切り替えず、一般回答構成を改善してから再比較する。

- [ADR 0073: 根拠付き旅行案を構造化選択から描画する](0073-render-grounded-travel-plans-from-structured-selections.md) — 一般旅行相談でEvidenceに結び付いた行程・AI概算・写真をApplicationが一括描画する。

- [ADR 0074: Agent task・意味判断・会話Working Stateを型付き契約にする](0074-establish-agent-task-decision-and-working-state-contracts.md) — 型付き判断、提示参照、原子的Working State、production-shaped Evalの共有境界を定める。
