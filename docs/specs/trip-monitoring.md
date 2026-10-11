# TripWatch / TravelEvent / TripImpact

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
観測metadataは同identityの新しい観測として別途扱える。Event永続store/自動upsertはない。

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
- Weather: #408の[hourly Event正規化・時間帯評価](trip-impacts.md)を追加した。
  旧単点contractからbounded forecastへ統合し、同じ内部subject routing/Impact storeを再利用する。

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

## TripChanged durable delivery

正本は#382/#415と最新#407。[ADR 0059](../decisions/0059-deliver-trip-changes-with-a-transactional-outbox.md)で
Streams/outboxを比較した。#393の[Watch同期](trip-monitoring.md)を唯一の同期実装として使う。

## Atomic writer / signal

`DynamoDbTripRepository`:

- create: condition付きTrip Put + TripChanged Put。同じUUID/同内容のretryでは新signalを作らない。
- mutate: active/revision CAS Update + mutation receipt Put + TripChanged Put。
  prepare/validationに失敗すればwriteなし。transaction失敗でsignalだけ成功することもない。
  response lost時は既存receiptを再readする。receiptの再返却でsignalを二重作成しない。
- archive: active + old Trip JSON一致Update + TripChanged Put。concurrent editを旧revisionでarchiveしない。
  Domain Trip revisionを増やさない。既にarchiveされたresourceは従来どおりnot-found。

TripChangedは以下の6fieldのみ。extra fieldをrejectする。

| field | 正本 |
| --- | --- |
| eventId | SHA256([tripId, revision, kind])。owner namespace内で安定 |
| ownerSubject | 同transactionのTrip PKから抽出したtrusted routing |
| tripId / revision | 検証した保存対象Trip。revision必須 |
| changedAt | server Clockの時刻（mutationは保存updatedAtと同値） |
| kind | created / mutated / archived |

検索候補、Trip本体、Party/Place詳細、予約private、外部factは含めない。Applicationは外部からsignal本文を受け取らない。
Browser/AgentへのDTOには追加しない。Trip IDが別ownerで同じでもPKが異なり配送/Watchを混合しない。

## Storage / Query / capacity

既存暗号化・PITR・削除保護付きtableを使う。

- PK `OWNER#subject` / SK `TRIP_CHANGED#eventId`
- storageVersion=1、event(JSON)、deliveryVersion、attempts、deliveryState
- pending: `outboxShard=pending#0..3`、`availableAt=epoch milliseconds`
- dead: `outboxShard=dead#0..3`、`availableAt=quarantined time`
- done: 索引属性を外す。履歴は保持する。

`trip-changed-due` GSIはoutboxShard+availableAt、KEYS_ONLY。
4固定shardを各10行、昇順Queryする。毎tick最大40件、残時間が少なければ未claimで次回へ残す。
bounded pageであって「全部同期済み」の証明ではない。backlogは持続してQueryされ、Scan/owner list APIはない。
索引は結果整合なので、取得keyをbase tableでConsistentReadし、state/version/availableAtを再確認する。
同じ索引rowの再配送・一時的に残るdone/dead hitはskipする。
恒常的に毎分40件を超える場合はlagを検知して容量を見直す。固定shard変更には既存行の移行が必要。

## Consumer / ordering / retry

1. 指定した内部EventBridge ruleがLambdaを起動する。tickにはTrip/owner routingを持たせない。
2. due key→一貫性read→deliveryVersion CASでattemptを増やして120秒leaseを保存する。
3. event schema、eventId、owner PK一致を検証する。偽ownerは呼出前に隔離する。
4. `TripWatchApplication.reconcile({subject}, tripId)`を呼ぶ。
   payloadのrevisionは観測用で、Watch生成に使用するTripは既存reconcileが最新GETする。
5. #409の[recheck投影](../operations/trip-rechecks.md)も保存できた後だけversion付きdoneへ移す。
   Watch同期を複製せず、その完了後にtaskのidempotent ensureを追加する。片方だけ成功した場合もoutboxをACKしない。
   失敗時はbackoff pending、8回でdeadへ移す。

rev5→6、6→5、同じevent、同じtickの再送でも最新Tripへreconcileする。
#393のsourceTripRevision/Trip ConditionCheck/collection CASを利用し、旧eventから巻き戻さない。
同期中に新revisionが保存されれば既存CASがrejectし、次のretryと新signalで最新へ収束する。
Watch batch中断はcomplete=falseのまま、次回reconcileが保存済み残差分を適用する。
consumerにWatchの差分、transaction、独自回復を実装しない。

claim後にprocessが死んだ場合もattemptは保存済み。lease expiry後に同じkeyから再開する。
Watch成功後のresponse lostでもreconcileを再実行可能。done ACK後のresponse lostはdone再readで終了する。
古いworkerのfinishは新しいclaim versionを上書きできない。

archive/missing→既存Watch inactive、cancelled/completed→空desired setを既存reconcileが処理する。
TripとWatch collectionが両方存在しない場合の#393 not-foundのみをno-op成功扱いにする。
unavailable/conflictを「Trip削除」と扱わない。Watch・Trip・Reservation・Checklistをcascade削除しない。

backoffは30/60/120/240/480/960/1800秒（tick周期とGSI反映で追加遅延あり）。
実処理は最大8claim。Lambda timeout90秒、claim lease120秒、起動retryも別にboundedとする。
poison payloadはdeadへ移して次のrecordを続行する。storage全体の障害/ACKの失敗ではpollを失敗させ、
成功扱いにしない。未処理行とleaseは残り、後のtickが回復する。

## DLQ / operational recovery

**本体DLQはDynamoDBのdead partitions**。自動失効・自動redriveはない。
EventBridge/Lambdaの起動失敗DLQは**SQSのtick専用queue**（14日保持）。両者を混同しない。
SQSが期限切れしてもpending/dead本体は残り、起動を直せば再Queryできる。

運用手順:

1. `Raiquora/TripChanged`のDLQ/ReconcileFailure、heartbeat alarm、SQS backlogを確認する。
2. IAM/デプロイ/容量を修復する。Trip本文や予約をlog/Issueへ貼らない。
3. 本体のdeadを調べるときは`trip-changed-due`の各`dead#0..3`をQueryする（Scanしない）。
   ownerをpublic requestから指定して実行する機能ではなく、権限を持つoperatorの内部作業とする。
4. 正当なpayloadは`DynamoDbTripChangedOutbox.redrive(key, expectedVersion, now)`で明示CAS再配送する。
   同じeventIdでattemptをresetし、最新Tripから再処理する。公開HTTP/自動tickにはこの操作を配線しない。
5. malformed payloadは安全なeventを保存せずkey/配送metadataだけ残すため、そのままredriveできない。
   変更履歴等の信頼できる運用資料で対象Tripを確認し、正規Repository更新または承認したinternal reconcileで修復する。
   missing field/ownerを推測して復元しない。修復確認後も履歴を無言削除しない。
6. complete/sourceTripRevisionと最新Trip revisionをowner-scoped readで確認し、lagの回復を確認する。

## Observability / security / rollout

固定名のEMF metric: Received、DuplicateOrStale、ReconcileSuccess、ReconcileFailure、Retry、DLQ、ProjectionLagMs、PollSuccess。
ProjectionLagMsはsignal.changedAt→reconcile/ACK成功の経過時間。全Trip同期済み/外部情報確認済みの証明ではない。
private例外は固定categoryへ変換する。logにowner/event JSON/Trip/Party/Place/Reservationを含めない。
DLQ発生、5分超の成功時lag、10分のheartbeat欠落、tick SQS backlogをCloudWatch alarmとして追加する。
alarmは運用者向けで通知先は未設定。利用者Push/Notification #395とは別。

workerは特定ruleのInvokeFunction、tableのGetItem/Query/PutItem/ConditionCheckItem、
配送indexのQuery、専用queue SendMessage、専用log groupへのwriteだけを持つ。
SDKはAdapter内、公開Lambda/Function URL/HTTP route/Agentは変更しない。
Event payloadの形やARN文字列だけを認可とはみなさず、IAMで任意callerの直接invokeを許さない。

通常buildが別bundle `dist/trip-changed/index.cjs`を生成し、manifestからTerraformへ渡す。
既存CI/CDのbuildが両bundleを生成する。内部timerの実行設定はTerraformが所有する。
Trip writerは公開済み。内部workerに公開HTTP入口は設けず、LocalStorageからのmigration/dual-writeは行わない。
適用以前の未変更Tripにはイベントがない。初回同期が必要な既存Tripは承認済み内部作業でreconcileする。
Repositoryを通らないtable直書きはoutbox保証の範囲外。新しいwriterは同じRepositoryを必須とする。
