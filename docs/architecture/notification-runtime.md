# Trip Notification runtime（#395）

正本: #382 / #415 / #395、[ADR 0063](../decisions/0063-separate-notification-episodes-and-delivery.md)。

## Before / After と責務

従来は保存済みTripImpactまで。今回、決定論的policy・episode・独立通知resource・配信worker・一覧を追加する。

| 層 | 正本/実装 | 変更しないもの |
| --- | --- | --- |
| 外部事実 | 既存TravelEvent / #409 recheck | Provider rawや外部現在値をTripへ保存しない |
| Tripへの影響 | 既存TripImpact / typed facts / revision fence | sent/read/suppressedを追加しない |
| 通知判定 | `notification-policy.ts` | AI/自由作文/新規外部検索を使わない |
| 通知状態 | `TripNotification`, `NotificationEpisode` | Trip/Reservation/Checklist/Feasibilityを変更しない |
| 配信 | `NotificationDelivery` / in-app receipt | #409から直接配信しない |

`TripNotification`はブラウザのglobal `Notification`と区別した同一resourceの名前であり、並行モデルではない。
Domainはpureで時計とhashを引数として受ける。Backend adapterだけがDynamoDB/AWS/暗号hashを知る。

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

**本番は従来のend-user認証gateが閉じたままなのでNotification APIも501である。**
CloudFront/IAM origin protectionをユーザー認証とみなさない。通知worker/tableは独立で配備できるが、
一般ユーザーが一覧を使うには既存Trip APIと同じ本物のprincipal verifier・read/markRead権限をreviewして配線する必要がある。
今回は`createNotificationHandler(application, authenticate)`とHTTP/UIを実装・テストし、fake ownerやpublic writer解除はしない。
Web Push/VAPID/外部鍵の準備は不要。アプリを閉じている端末へPush送信する機能は今回ない。

## Migration / rollout / 後続

新tableのみ。旧Trip/LocalStorage、TravelEvent、ImpactのDomain schema migrationはない。
過去Impactから一斉通知backfillしない。正規#409 recheckから新鮮なsignalが入って開始する。
deployはtable/IAMを先に成立させ、両Impact producerへNOTIFICATION_TABLE_NAMEを同時設定する（Terraform depends_on）。
既存producerのoutboxなし旧versionとの混在期間の再評価は#409が担う。今回Terraform applyはしない。
server writer gate・#396 in-trip Context・#397 AI再計画・その他channel/購読管理は変更しない。

## Acceptance Criteria自己レビュー / 検証対応

| 要求 | 確認箇所 |
| --- | --- |
| Impact/Decision/Notification/Delivery分離、AI不使用 | Domain・ports・infra静的tests |
| current Trip/revision/terminal/affected item | policy tests、Trip競合SDK/application tests |
| 重複/recheck/escalation/A→B→A/解消後新episode | policy・application tests |
| typed rail/schedule/cancel/weather/hazard文面 | policy tests（unknownや施設危険断定を含む） |
| 原子的作成・CAS・owner isolation・応答消失 | SDK条件式fakeと実Applicationを結合したtests |
| retry/lease/crash/DLQ/redrive/disabled channel | application tests |
| unread/read/navigation/historical/private非露出 | UI/HTTP/handler/application tests |
| public triggerなし、least privilege、package | Python infra tests、Terraform validate、lambda check |

SDK fakeは条件式・atomic writeのcontract検証であり、実AWSのIAM/障害注入統合試験とは区別する。
Agent/Prompt/Tool/Contextは不変。Smoke/Fullはscripted評価、Liveの追加は不要で、従来のAWS認証期限切れ未実施記録を維持する。

2026-09-17ローカル検証: npm test（Frontend/Domain 1,782件、Backend 422件）、build、architecture/workspace、
Smoke（12/12 + Ask 2/2 + Progress 19/19）、Full（42/42 + Ask 7/7 + Progress 35/35）、Python 32件、
Terraform fmt/validate、bundle/lambda、diff --checkが成功。Terraformはhash_keyの非推奨warningあり。
実AWS apply/実端末Push/Live model追加評価は実施しない。GitHub CIはPRで別途確認する。
