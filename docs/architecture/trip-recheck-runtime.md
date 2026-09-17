# Trip再チェックruntime (#409)

正本: #382/#415/#409、[ADR 0062](../decisions/0062-schedule-trip-rechecks-with-shared-durable-due-work.md)。

## Before / After

- Before: TripChanged→Watchはdurable。Weather/Hazard/Rail→Event→Impactは内部seamのみで、時刻起動hostなし。
- After: outbox ACK前に独立taskを投影し、共有tickでdue Query→lease→最新Trip/Watch→Provider→既存Event/Impactを実行する。
- 再利用: TripWatchApplication/projector/diff/CAS、TripImpactApplication/router/Repository/fence、3種Event mapper、
  Open-Meteo/JMA Provider、S3JourneyDataRepository。独自Watch同期/Impact storeは追加しない。

## 所有ファイル

- `modules/trip/domain/trip-recheck.ts`: versioned時刻policy、horizon、期間分割。
- Backend `contracts/trip-recheck.ts` / `ports/trip-recheck.ts`: 内部task・Repository・Provider境界。
- `usecases/trip-recheck-application.ts`: 投影・最新状態検査・再試行/replay orchestration。
- `adapters/dynamodb-trip-recheck.ts`: 別table、due GSI、claim/ACK CAS、poison isolation、operator redrive。
- `adapters/recheck-target-resolver.ts` / `s3-recheck-target-catalog.ts`: 根拠付き地点/区域binding。
- `adapters/provider-recheck-source.ts` / `collector-recheck-source.ts`: 既存Provider/collectorから正規化Eventへ。
- `trip-recheck-composition-root.ts` / `trip-recheck-lambda.ts`: IAM-only tick、数値metric。
- `infra/terraform/environments/dev/trip-recheck.tf`: shared timer、private table、least-privilege role、DLQ/alarms。

## 必要な本番設定とrollout

新しいAPI keyは不要。既存日付別indexと`api/traffic/delays.json`を読む。
ただし**hazard target catalogの準備が必要**。`${resource_prefix}-data-builder-source`の
`runtime/trip-watch-targets-v1.json`に、権限を持つoperatorが確認したbindingを置く。
repositoryに施設情報やProvider rawを同梱せず、通常の利用者/Agentには書込権限を付けない。

形式は`{ schemaVersion: 1, bindings: [{ ref: PlaceRef, area: string, sources: ExternalSourceEvidence[] }] }`。
refはprovider+opaque ID/canonical key。sourcesは公開URL/安定source ID・取得時点・非unknownの根拠を必要とする。
施設名→市町村の推定表ではなく、**そのidentityとquery areaの関連を確認した情報**を登録する。
空bindingsは明示的に未解決と扱う。catalogなし/読込失敗は投影のretryであり「警報なし」ではない。
同じrefの複数bindingはfirst-winsにせずunknown。既存Placeのmanual/座標なし/根拠不足も補完しない。

1. catalogと既存collector/indexの対象key・IAMを確認する。
2. Terraformをreview/applyし、build済みworkerを配備する（本PRの検証はapplyではない）。
3. 新しい正規Trip writeは既存outboxから自動投影される。
4. 既存Tripは承認された対象だけ`createRecheckProjection(...).projection.reconcile(principal, tripId)`で初回同期する。
5. sourceTripRevision/active Watch/task、metric、Impactのrevisionを確認する。

catalog修正後は解決taskのretryまたは明示redrive/reconcileを行う。policy version更新時も新task投影が必要。
旧taskは実行時にstale/inactiveへ移り履歴を残す。過去の全Tripが自動backfill済みとは扱わない。
Watchを作れない場所、unscheduled、区域の包含/警報有効期間、予報の欠測は引き続きunknown。
weather/hazardの精度・severityは#408のままで、取得成功≠安全・営業確認済み・ready。

## DLQ / replay / metrics

- 本体: `recheck-due`の`dead#0..3`をQueryする。TTL/物理削除なし。
- 正当なtaskは`DynamoDbTripRecheckRepository.redrive(key, expectedVersion, now)`でCAS再投入する。
  taskからownerを受け取る公開操作はない。最新版のTrip/Watchを再GETするため、旧revisionのredriveはskipする。
- poisonはrouting key/配送metadataのみ残し、元のprivate/raw本文を保存しない。redriveせず信頼できる正規Tripから投影し直す。
- 起動SQS DLQはtickだけ。Queue滞留、PollSuccess heartbeat、DLQ、RecheckLagMs、ProviderFailure alarmを確認する。
- 三回のfresh reingestはGSI lag回収の機会を増やす運用policyで、coverage完了証明ではない。
  `ReplaySuccess`は非空再処理passの成功。最初のroutes=0では完了せず、上限後も0ならDLQへ送る。
- DueTasks/Claimed/Executed/StaleRevisionSkip/ProviderSuccess/Failure/Timeout/RateLimit/EventGenerated/
  ImpactSaved/ReplayRequired/ReplaySuccess/RecheckLagMs/Retry/TargetUnknown/DLQ/PollSuccessを固定数値metricへ出す。
  ImpactのUnknown/NoImpact/Impact等は既存namespaceも維持する。ログに生owner/Trip/予約/Provider例外は出さない。

## テストと残す責務

Domain時刻、Provider/collector normalization、SDK fakeの条件式/lease/CAS、実Watch/Impact Applicationを結合した
遅延routing・revision競合・応答消失・backoff・DLQ/redriveを試験する。実AWSのIAM/Provider統合試験とは区別する。
Agent/Tool/Prompt/Context変更なし。Smoke/Fullを維持し、Live追加なし。従来のAWS認証期限切れ未実施記録は維持する。
Notification/dedupeは独立した[Notification runtime](notification-runtime.md)（#395）、in-trip Contextは#396、AI再計画は#397。Checklist/Reservation/計画Feasibilityは変更しない。
public writer gateも解除しない。#395でImpact保存transactionに最新観測signalの更新のみ追加する。
recheck workerはNotification/episode/read状態を変更せず、Pushも行わない。signal用IAMはUpdateItem・transaction内・属性allowlistに限定する。
