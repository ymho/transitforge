# TripChanged durable delivery (#407)

正本は#382/#415と最新#407。[ADR 0059](../decisions/0059-deliver-trip-changes-with-a-transactional-outbox.md)で
Streams/outboxを比較した。#393の[Watch同期](trip-monitoring.md)を唯一の同期実装として使う。

## Before → After / 所有境界

| 対象 | 以前 | 今回 | 後続 |
| --- | --- | --- | --- |
| Trip Repository | create/保存CAS/archive | それぞれの成功とoutbox Putを同transactionへ | 公開認証、writer rollout |
| Watch | pure projection、diff、CAS、reconcile | 変更なし。内部consumerから呼ぶ | #394の外部Event評価 |
| 配送 | 未実装 | pending/lease/backoff/done/dead、固定shard索引、内部poll | 実負荷に応じた容量/保持運用 |
| Agent/Domain Trip | 既存契約 | 変更なし | 本Issueでは触れない |

TripPrincipalの同じ型/validationをcontractsへ移し、既存ports importから再exportする。
別のownerモデルや認証方式は作らない。Domain内へAWS/queueを持ち込まない。

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
5. 成功後だけversion付きdoneへ移す。失敗時はbackoff pending、8回でdeadへ移す。

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
既存CI/CDのbuildが両bundleを生成する。Terraform適用後に内部timerが有効となるが、本PRでapply/本番実証は行わない。
public writerはOFFのまま。過去のTrip JSONやLocalStorageをmigration/dual-writeしない。
適用以前の未変更Tripにはイベントがない。初回同期が必要な既存Tripは承認済み内部作業でreconcileする。
Repositoryを通らないtable直書きはoutbox保証の範囲外。新しいwriterは同じRepositoryを必須とする。

## #394 / #409へ残すruntime routing

この節は#407導入時の残務を示す。#394で[rail subject routingとImpact評価・保存](rail-trip-impact.md)を導入した。
outboxの再利用によるowner列挙は行わず、#409の定期的な観測再投入は引き続き別責務とする。

watch-subjectはowner+subjectであり、共通運行Eventから全利用者へ検索する索引ではない。
このoutbox indexをowner一覧として転用しない。
後続はsubjectから認可されたowner/Tripへ逆引きする内部routing contractと索引を明示的に定め、
更新/削除/CAS、GSI lag時の再評価、replay、principal権限、bounded fanoutを設計する。
「ownerをどこかで列挙する」だけでは未実装扱いとする。

## AC / validation

隣接consumer testsは実DynamoDbTripRepository / TripWatchApplication / Watch RepositoryをSDK fakeで結合する。
create/CAS/archiveとoutboxの原子性、A→B/date/remove、terminal/missing、5→6/6→5、duplicate、response loss、
120 Watchのpartial failure、claim競合、lease expiry、bounded retry/dead/redrive、poison/偽owner、private非露出を確認する。
Lambda negative testsとPython infra testsが公開入口・余分なIAM・package・retry/DLQを検査する。
AWS実サービスの試験ではなく、condition式を評価するfake＋Terraform validateである。

全test/build/architecture/workspace/Smoke/Full/infra/fmt/validate/diffを実行する。
Agent/Tool/Prompt/Contextは不変、model/tool call増分0。Live Evalは追加しない。
