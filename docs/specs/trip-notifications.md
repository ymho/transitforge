# Trip Notification runtime

## Durableな入力と最新観測

本番`DynamoDbTripImpactRepository.save(..., event)`は既存Trip ConditionCheck＋Impact Putに、
別tableのSIGNAL Updateを同一transactionで追加する。Impactとdecision待ちのdual-writeはない。
notification未設定のテスト/独立repositoryは従来contractを維持するが、本番compositionはenv欠落時fail closed。

signalにはowner storage key、Trip ID/revision、Impact ID、dated subject/scope、kind、observed/evaluated/expiry、fresh判定だけを保存する。
Event本文・Trip全文・場所・Party・予約privateは含めない。Impact IDは内部state identityであり公開DTOへ出さない。
既存TravelEventのsourcesからfreshness上限を計算し、railは5分、weather/hazardは1時間またはsource expiryの早い方。
保存済みImpact単独を永続的な最新状態の証拠にしない。

signalのキーはowner＋Trip＋subject。weatherはrequestedRangeもscopeとし、別chunkの晴天を降水の解消に使わない。
revision昇順、同revisionでは`observedAt|evaluatedAt`の正規UTC順を条件に更新する。
古い観測の保存はtransaction conflictとして拒否し、Impactとpointerの片側だけを書き換えない。
同subjectの未処理状態は最新へcoalesceする。全過渡状態を漏れなく通知する履歴event queueではない。
`routes=0`は保存済みImpactがないので通知入力を作らず、解消としない。

## Policy / episode

- current Tripをowner-scopedで再GETし、revision・全affected item・非terminal・非archiveを確認する。
- 対象scheduleの前24時間〜終了まで。unknown schedule / stale factはunknownであり通知しない。
- informationalは通知しない。attention/action-requiredでもtyped riskがなければunknown。
- episodeはpolicy version＋Trip revision＋subject/scope。revision/policy変更時にhigh-waterを引き継がない。
- 同じ/弱いriskを同episodeで再通知しない。乗換余裕の段階悪化、必要時間割れ、5分単位の遅延/予定超過悪化、運休で再通知する。
- A→B→AはBまでのhigh-waterを維持。明確な解消後のAはgenerationを進めた別episode。
  unknown/無観測の時間経過だけで「解消した」「別episode」とは推測しない。
- weatherの降水量等の微小変化は同risk。hazardはcategory/public severityの悪化を扱うが通知severityはattention。
- freshでuncertaintyのないrail no-impactのみepisodeを閉じる。action-required以上だったときのみ解消通知を生成する。
  weather/hazardのquery-limited/欠測/unknownを無条件に解消へ変換しない。

文面はtyped connection-buffer / schedule-risk / reservation-risk / cancellation / weather/hazard exposureから生成する。
列車の代替案、施設の営業確認、中止推奨、施設危険の断定は追加しない。予約番号や施設名を自由文として取り込まない。
hazard文面は適用範囲・有効期間が未確認であることを維持する。

## Persistence / concurrency / delivery

別DynamoDB table、owner-scoped PK、schema envelope 1。TripのschemaVersion/revisionや既存データは変更しない。

| SK | 内容 |
| --- | --- |
| SIGNAL#trip#subjectHash | 最新観測＋decision job、完了後の低cardinality action/reason |
| EPISODE#trip#revision#policySubjectHash | episode CAS version / high-water / latest observation watermark |
| NOTIFICATION#opaqueId | pending/sent/failed/suppressed/read、Notification独自version、typed template文面 |
| DELIVER#opaqueId | delivery job、attempt、lease、CAS |
| INBOX#opaqueId | 冪等channel受領証（dedupeKeyのみ、外部subscriptionなし） |

decision commitは「Trip全文の一致ConditionCheck＋claim version＋episode CAS＋Notification初回Put＋delivery job Put」をatomicに行う。
worker応答喪失でも作成済みNotification IDを再使用する。claimのlease更新中に新観測が来れば古いworkerのcommitは失敗する。
送信前にも最新Trip/episode/観測を照合し、in-app receiptのtransactionでもTrip revision/archive、signal、episode versionをfenceする。
delivery adapterはowner-scoped Repositoryでvalidation済みcurrent Tripを再取得する。旧#388 storage envelopeは
トップレベルrevisionを持たないため、Trip mutationと同様に「revision一致、またはrevision属性なし＋exact current Trip JSON一致」を要求する。
JSONは既存Repositoryと同じ`JSON.stringify`形式とし、キーの再ソート等で保存形式を変えない。revision属性がないだけでは許可しない。
読み取り後のJSON変更やarchiveはtransactionで拒否し、受領証もsent状態も作らない。配信に伴うTripの書換え・migrationはない。
互換復号はdeliveryに限定し、すでにexact JSONを要求するImpact/decisionや既存mutationのCASを共通化のために弱めない。
送信後の状態更新が失敗してもINBOXのdedupeKeyが受領済みを維持する。readとsentの競合はNotification CASで保護する。
外部Push channelを将来追加する場合も同dedupeKeyを利用する。外部providerが冪等性を保証しない場合にexactly-onceを主張しない。

shared EventBridge tickは1分、4 shards×最大5件、Queryのみ。lease240秒、worker180秒、残30秒で次のclaimを止める。
失敗backoffは30秒×2^(attempt-1)、上限30分、最大8試行。SDK通信は接続3秒/要求15秒、最大2attempt。
crashはlease後再claim。poisonはallowlist metadataのみでdeadへ隔離。Trip/Impactをrollbackしない。
disabled channelはsuppressed。in-appはbrowser permission/subscriptionに依存しない。

### DLQ / redrive

`notification-due` GSIの`dead#0..3`をbounded Queryし、base tableをconsistent readする。
正規jobは内部operator権限で`DynamoDbNotificationRepository.redrive(key, expectedVersion, now)`を呼ぶ。
これはCASでattemptを0へ戻すだけで、Notification IDや観測時刻は変えない。期限切れ/旧revisionは再判定で抑止される。
poison payloadはredriveできない。まず破損原因を解消し、信頼できる#409再評価で正規signalを作り直す。
source revision metadataまで破損した行は通常writeで上書きできないため、operatorの個別承認付き修復が必要。
無制限retryや公開redrive endpointはない。

起動失敗はSQS tick DLQ（14日）、EventBridge最大6retry/1時間、Lambda async最大2retry/1時間。
tickのみの再配送とwork dead partitionは別。DLQ/Failed/DeliveryLatencyMs/heartbeatとSQS滞留alarmを用意する。
Decisions/Notify/Suppress/Resolve/Unknown/DuplicateSuppressed/Escalated/Queued/Sent/Retry/Failed/DLQ/Due/PollSuccessは固定数値metric。
ログにはowner/Trip/Event/private/SDK例外本文を出さない。

## API / Notification Center / 公開gate

`notification-api-v1`のlist/readのみ。ownerは認証済みserver principalから取得し、body/headerのowner指定は拒否する。
20件のowner-scoped pagination。cursorはNotificationのopaque IDで、PKを利用者から受け取らない。
初期一覧は安定したID順paging（全件時系列ソートではない）。既読は独立version CAS、同じreadの再送は成功。
公開DTOはid/version/tripId/tripRevision/itemIds/severity/status/phase/createdAt/message/currencyのallowlistのみ。

UIは明示操作で一覧を取得し、既読、現在警告/未確認/履歴、通知時点revisionを表示する。
Tripへの移動はowner-scoped GET後、既存Conversation参照とTripWorkspaceのserver sourceを使い最新版へ移動する。
履歴のitemが消えていればTrip全体を開く。新しいTrip/LocalStorage Trip writer/Agent dispatchは作らない。

**Notification APIの本番組成は未接続で501である。**
CloudFront/IAM origin protectionをユーザー認証とみなさない。通知worker/tableは独立で配備できるが、
一般ユーザーが一覧を使うには既存Trip APIと同じ本物のprincipal verifier・read/markRead権限をreviewして配線する必要がある。
`createNotificationHandler(application, authenticate)`とHTTP/UIは独立した能力として存在する。公開時も認証済みprincipalと権限の検証を必要とする。
Web Push/VAPID/外部鍵の準備は不要。アプリを閉じている端末へPush送信する機能はない。
