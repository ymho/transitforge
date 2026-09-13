# TripWatch / TravelEvent / TripImpact (#393)

親方針は#382/#415・ADR 0052。実装判断は[ADR 0058](../decisions/0058-separate-trip-monitoring-resources.md)。
本書は既存Tripを利用する監視境界であり、新しいTrip/Planner/Realtime正本を定義するものではない。

## 現行 → 今回 → 後続

| 現行の正本・不足 | #393で追加する境界 | 残す責務 |
| --- | --- | --- |
| SelectedRailJourneyの採用済みlegs・scheduled事実 | legのdated serviceから独立Watchへ投影 | #394の遅延・乗換・予約時刻影響 |
| ItinerarySchedule fixed/window/day/unscheduled | activeWindowへ精度を保って投影 | #395の通知時間帯policy |
| TrainDelaySnapshot: collectedAt、failedSources、番号別TrainOperation | 日付別時刻表との照合を必須とするrailTravelEvent | #394のsource契約を確認した運休・行先変更評価 |
| TrainOperation: delayMinutes/destination/sources/longTimeStopping、serviceDate/UIDなし | 一意の番号/UID bindingだけを採用し、不足はunknown | 全transport realtimeは別担当 |
| HazardAlertQuery + ExternalTravelInformation | query scopeを失わないhazardTravelEvent | #408の区域交差・暴露・天候影響 |
| owner-scoped Trip/Reservation/Checklist Repository | 同じprincipalのWatch保存・逆引き・reconcile | #407のdurable trigger、#399の認可拡張 |
| TripImpact未実装 | strict contractとevaluator port・worker seam | #394/#408の実評価・保存、#395の通知 |

## Domain

`modules/trip/domain/trip-watch.ts`が唯一のWatch契約。Trip本体に配列を持たない。

- TripWatch: id、tripId、itineraryItemId、sourceTripRevision、subject、activeWindow。
- WatchSubject: rail-service(serviceDate, serviceUid?, trainNumber?)、hazard-area(area)、weather-area(area)。
- rail identityはserviceDate+serviceUid。UIDが存在する場合はtrainNumberが変わってもidentityを維持する。
  UIDが欠ける場合だけdate+number。現在のSelectedRailJourneyはUID必須なので、projectionでfallbackを
  捏造する必要はない。外部subject/将来input向けに同じidentity helperがfallbackを検証する。
- 同じTrip/item/subjectは同じID。異なるserviceDateは別ID。表示名・タイトル・ランダム値を使わない。
  同一itemで同一serviceへ再乗車する場合は、そのserviceの最早departure〜最終arrivalの監視範囲へまとめる。
  Tripのleg/stop indexや予定そのものは変更しない。
- rail activeWindowは各legのscheduled時刻。非railではtrusted scopeがあるitemだけ、同じscheduleを使う。
  fixedの終了不明、windowの幅/任意duration、dayのexclusive endDate/未知zone、unscheduledをそのまま保持する。
  暗黙の前後bufferは0。後続で追加するならversion付きDomain policyとして試験する。
- cancelled/completedは空のdesired set。archiveはTrip Domainではなく既存Repository visibilityで扱う。
- ResolvedWatchScopeはinternal trusted resolverが生成し、item IDを検証する。`PlaceSnapshot.area`も
  自動的にtrustedなJMA区域とみなさない。既定resolverは空。ホテル名/Activity名からの地域推定はない。
- `diffTripWatches`はunchangedとwrites（create/update/reactivate/deactivate）を返すpure関数。
  対象変更は新ID＋旧ID inactive。revisionが変われば同IDのsourceTripRevisionを更新する。
  inactiveには最後に監視対象だったrevisionを残し、同期済みrevisionは集合metadataが持つ。

## 保存・逆引き・同期

`DynamoDbTripWatchRepository`は既存Trip tableへ以下を保存する。

| record | PK / SK | 中身 |
| --- | --- | --- |
| Watch | OWNER#subject / WATCH#tripId#SHA256(watch.id) | storageVersion=1、Watch JSON、active、sourceTripRevision |
| 同期metadata | OWNER#subject / WATCH_STATE#tripId | storageVersion=1、集合version、sourceTripRevision、complete |
| sparse GSI | watchSubject=SHA256(owner + canonical subject)、SK=同じsk | KEYS_ONLY、active Watchだけ |

DomainのIDは衝突しない構造化JSON keyで、Adapterだけがキー長制限のためhash化する。
payloadをdecodeするときは元identityからhashとowner/Trip/revisionを再照合する。
GSI IAMは`.../index/watch-subject`へのQueryのみ。Trip tableへ同期条件確認用のConditionCheckItemを追加する。
Scan、wildcard resource、public routeなし。
trusted workerもownerを明示する。全ownerの列挙/認証はこの索引に混ぜない。

reconcile手順:

1. trusted principalを検証し、保存済みTripを読む。呼出側やモデルからTrip本体を受け取らない。
2. Watch metadata→owner/Trip Query全page→metadataを読み、集合versionが変わった読込はconflict。
3. desired setをpure projectionし、保存済み集合との差分を計算する。
4. 最大98 Watch/transactionで、Tripの保存JSON・active状態のConditionCheck、集合CAS、差分Putを同時実行。
   既存#388 envelopeのrevision属性欠落にも保存JSON一致で対応する。Trip自体を書き換えない。
5. 中間batchはcomplete=false、最終batchだけtrue。途中失敗の読込は可能だがworkerには未公開。
6. 同じreconcileを再実行すると既に書けた行はunchangedとなり、残差分だけを書いて公開する。

保存されていないTripを先にWatch化しない。Tripの変更/削除/取消と並行した古いsyncはConditionCheckかCASで
失敗する。旧revisionを新revisionへblind rebaseせず、最新Tripから再生成する。
同revisionでscope resolverが更新された場合も集合CASで同期同士を直列化する。
応答消失時もread/reconcileが回復入口。Trip更新のrollbackは行わない。
no-opでもTrip条件を確認し集合versionを更新するが、Watch行のID/内容やTrip.revisionは増殖しない。

archive/取得対象なしの場合は既存ownerのWatchだけをdeactivateする。保存されたTripが存在しactiveなままの
通信失敗を「削除された」と扱わず、Repositoryのunavailableはそのまま失敗する。物理削除はない。
レコード上限は1 Tripの履歴込み1000 Watch、1 Watch 16KB、Query全体1000行・最大100page。
上限超過はpayload-too-large/失敗として返し、途中切り捨てて完了としない。履歴整理policyは将来の明示作業。

GSIは結果整合であり、新規対象を一時的に取りこぼし得る。既知のindex hitからowner/Tripの集合を
base tableで再読込し、complete/sourceRevision/active/subjectを検証する。旧行・中間集合を使わない。
「空のlookup＝安全」とは説明しない。#407の確実なsync起動・監視lag/retry、#394の再評価が必要。
現段階はinternal compositionのみであり、自動監視・常時worker稼働・通知はまだ有効ではない。

## TravelEventと変換

`travel-event.ts`はkindごとのsubject/fact union、id、observedAt、sourceEvidenceIds、既存sources、freshnessを持つ。
Unknown/unavailableはmissing/failed/identity-unresolved/invalidを明示する。unknown/staleを定刻や安全にしない。
raw response、notification field、未知fact fieldはstrict validationで拒否する。
外部入力からは`travel-event-projection.ts`がallowlistで明示構築する。

Event identityはkind+canonical subject+fact+freshness。観測/取得時刻とEvidence IDだけの更新では増殖しない。
5分→10分は別Event、5分→10分→5分は元の5分状態keyへ戻る。通知episode/再通知のdedupeは#395に残す。
観測metadataは同identityの新しい観測として別途扱える。Event永続store/自動upsertは今回追加しない。

- Rail: date-specific TrainIndexとsubjectの一致、一意のUID/number対応を確認。snapshotの業務日と既存5分鮮度を
  検査する。部分失敗、欠落、番号が複数serviceへ対応、source不明はunknown/unavailable。
  operation.sourcesをTripへコピーせず、Applicationが供給する検証済みExternalSourceEvidenceを使う。
  Evidenceはobserved/event、取得/観測時刻を確認する。欠落からcancelled=falseやdelay=0を補わない。
  既存snapshotの欠落を運休とみなすViewer表示policyは監視seamへ流用しない。
  明示cancelledはRailEventFactに表現できるが、既存TrainOperationにはないのでこのmapperは生成しない。
  行先名を計画との差分と断定せず、観測destinationだけを返す。差分と重大性は#394が評価する。
- Hazard: queryとresultを対にし、失敗してdataがなくてもareaを保持する。availableはcategory/public severity/
  providerAlertId/issuedAt/issuer/title/summary/sourceUrlを維持する。複数alertはIDで安定順序にする。
  queriedCategoriesとquery-limited coverageを持ち、0件でも「区域内に警報なし」を保証しない。
  source鮮度を観測時点で再確認し、未来の取得/発表やEvidence欠落はunknown。
  category/areaがqueryと違う結果は拒否。公的emergencyからTrip criticalへ変換しない。
- Weather: 独立subjectとstrict fact contractのみ。実Provider変換・Tripへの雨の影響評価は#408。

sourcesは既存ExternalSourceEvidenceであり別Evidenceモデルを増やさない。sourceEvidenceIdsとの一致を検証する。
観測結果の保持可否や歴史Event storeのretentionは後続の保存設計で再確認する。

## Impactとworker

`TripImpact`はid、tripId、tripRevision、eventId、status、severity、affectedItemIds、reasonCodes、evaluatedAt。
statusはunknown/no-impact/impact。非impactのseverityはinformational。reasonは列挙値でAI文章ではない。
public Hazard severityとは別union、通知状態は未知fieldとしてrejectする。
`isCurrentTripImpact`でTrip/revision/event/affected itemを検証する。古い結果は履歴であり、新しいTripの最新結果ではない。

`TripWatchWorker.process`はowner/subject lookup→最新Trip→read-only ReservationFact→注入evaluatorの順に呼ぶ。
stale Watch、archive/terminal Tripをskipし、評価中にTrip revisionが変われば生成結果を返さない。
評価器への入力はcloneし、Trip/Reservation/Checklist/Feasibilityを変更するportは持たない。
戻った後にもTripは更新され得るため、後続のImpact保存/通知でもrevision確認が必要である。
activeWindowは評価器へ渡す。時間帯による通知抑止をこのworkerで先取りしない。

実Impact評価は#394/#408の必須注入port。仮の「影響なし」実装をproductionへ配線しない。
予約Reader失敗はunknown予約ゼロ件へ変換せず処理を失敗させる。Tripが存在することと予約確認済みは別。
複数Tripの途中で失敗しても保存・通知副作用はなく、同eventを再処理できる。SQS/DLQは未導入。

## Migration / Agent / 検証

Trip JSON、legacy converter、LocalStorage writer、公開認証gateを変更しない。新しいWatch namespaceに対して
internal reconcileで生成するだけで、旧データ破棄やdual-writeはない。
Agent/Tool/Prompt/Context/UIに変更なし。LLM呼出し・Tool呼出し増分0、runtime latencyへの追加なし。

適合試験は隣接`trip-watch.test.ts`、`travel-event.test.ts`、`dynamodb-trip-watch-repository.test.ts`、
`trip-watch-application.test.ts`と`tests/infra/test_trip_storage.py`。
単/複数leg、identity優先順位、各schedule精度、未知値、差分再送、revision変更、owner分離、
GSIの遅れ、中間batch失敗→回復、Trip書込race/応答消失、Event同定、Impact revisionを検証する。
SDK fakeは条件式と原子性を検査するもので、実AWS DynamoDBの統合試験ではない。

`npm test` / build / architecture:check / workspace:check / Smoke / Full / Python infra /
Terraform fmt・validate / bundle / lambda / git diff --checkを実行する。A〜AIと閾値は変更しない。
Live EvalはAgentを変更しないため未実施。既存のAWS認証期限切れによる未実施記録は維持する。
実AWSへのTerraform apply、worker稼働・通知の実証は行わない。

最終ローカル確認: TypeScript 1,991件（frontend/shared 1,688 + backend 303）、Python 18件が成功。
Smokeは保存済み12/Ask 2/Trip Progress 19、Fullは42/7/35で全件成功した。
build、architecture/workspace、bundle、Lambda、diff、Terraform fmt/validateも成功。
Terraform Providerの起動にはsandbox外のローカル通信が必要だった。AWS Providerのhash_key/range_key
非推奨警告は残るが、既存key schemaの置換は本Issueの目的外なので実施しない。

## #393 ACの自己レビュー

| AC | 実装/試験 |
| --- | --- |
| 同じservice/itemを再投影してもstable、別日を分離 | watchSubjectKey / projectTripWatchesとDomain tests |
| 計画とrealtimeを分離 | Trip変更なし、rail scheduled projection、allowlist Event、worker不変試験 |
| owner-scoped保存と逆引き、Scanなし | Repository＋sparse GSI＋A/B/negative infra tests |
| retry/差分/obsolete deactivate/reconcile | collection CAS・batch publication・lost response/partial failure tests |
| 同じ外部状態は重複Eventにならず、変化は別identity | travelEventIdとrail/hazard tests |
| failed/staleをnormalと扱わずHazard scope保持 | projection/validation tests |
| ImpactはTrip revision/eventへ結合し通知と分離 | strict validator・worker再確認tests |
| #394 evaluatorへ接続可能、実評価を先取りしない | required TripImpactEvaluator port、synthetic worker tests |
| Agent品質ゲートとpublic writer gate維持 | 全既存Eval・lambda未配線のnegative tests |
