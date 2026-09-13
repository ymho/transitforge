# ADR 0059: Trip変更をtransactional outboxでWatchへ届ける

- ステータス: Accepted
- 日付: 2026-09-14
- Issue: #407、親 #382 / #415、前提 #388 / #389 / #393

## 現行と不足

Trip mutationはDynamoDBのTrip CASとreceiptを同時commitする。create/archiveは個別writeだった。
#393はowner-scoped Watch projection、collection CAS、中間batchのcomplete=false、reconcileを実装済みだが、
Trip成功からreconcileへ確実につなぐ起動・配送がない。HTTP応答後のsendでは障害の隙間を埋められない。

## 比較

| 方式 | 長所 | この構成での課題 |
| --- | --- | --- |
| DynamoDB Streams単独 | write変更を自動捕捉、既存writer変更が少ない | 記録は24時間。長期停止後の回収には別の永続原本/再走査が必要。imageにはTripや同居する予約のprivate値も含み得る |
| transactional outbox + Streams | payloadを小さくでき、期限後も原本が残る | Streamsと期限後の回収経路を両方管理する必要がある |
| transactional outbox + indexed poll | Tripとsignalの原子性、期限なしの再回収、既存DynamoDB/Lambdaで実装可能 | create/archiveもtransaction化、通常約1分の起動遅延、配送stateの管理が必要 |

3を採る。小規模な現行構成で即時性より未処理signalの保持と回復性を優先する。
これは定期的にTripの天候を評価する#409ではなく、配送待ちoutboxを排出する1本の内部timerである。
Kafka、独立Event platform、全Trip Scan、HTTP後のbest-effort dual-writeを追加しない。

[Streamsの24時間保持](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.html)と
[AWSのoutbox設計](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html)を参照した。

## 決定

- createはTrip+signal、mutationは既存Trip CAS+receipt+signal、archiveはactive/旧JSON条件+signalを同時commitする。
  archiveでDomain revisionを勝手に増やさず、kindとrevisionを組にして識別する。
- TripChangedはeventId/ownerSubject/tripId/revision/changedAt/kindだけ。ownerはTrip writeのPKから作る。
  Trip JSON、Party、Place、Reservation、候補、Watchそのものをコピーしない。
- 同じtableのOWNER#subject/TRIP_CHANGED#hashへ保存。event IDはTrip ID+revision+kind、owner namespace内で安定。
  pending/delivery lease/backoff/done/deadはこの内部配送resourceが所有し、Tripへ追加しない。
- 固定4 shardのsparse GSI（KEYS_ONLY）を1分ごとに最大10件/shard Queryする。
  GSIの遅れはbaseの一貫性read/CASで再検査する。新規hitの遅れは次のtickで回収し、期限切れで捨てない。
- claim時にattemptを永続化して120秒lease。worker timeout90秒、残15秒未満なら新規claimしない。
  8回まで、失敗後30秒から指数backoff・最大30分。timeout/応答消失後もlease expiryで再処理する。
- consumerはTripWatchApplication.reconcile(principal, tripId)だけを呼び、必ず最新TripをGETする。
  古いイベントも最新計画へ収束し、独自projector/Watch transaction/rollbackを追加しない。
- 最大試行後とmalformed eventは同tableのdead shardへ隔離する。期限なし、明示redriveだけ。
  invalid payloadはコピーせずkeyと配送metadataを残す。正当なeventだけをCAS付きで再配送可能にする。
- EventBridge起動失敗とLambda非同期起動失敗は専用SQS DLQへ送る。
  SQSにはtickだけでTrip/ownerがなく、14日経過しても本体のpending/dead recordは失われない。
- public endpoint・authorizer代替は作らない。専用LambdaへのEventBridge permissionは特定rule ARNに限定する。
  payloadのsource/resources検証は補助であり、認可はIAMを正とする。
- log/EMFは固定metric名と数値だけ。生owner/event/Trip/privateエラーを記録しない。

[EventBridgeのretry/DLQ](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rule-retry-policy.html)と
[transaction IAM](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis-iam.html)に沿って、
table/index/関数/queue/log group単位の権限と起動retryを追加する。Secrets/Bedrock/Watch subject GSI権限はworkerに不要。

## Migrationと後続

Trip JSON/schemaVersion/revision契約、LocalStorage、公開writer gateは変更しない。
適用後の正規Repository更新からsignalを保存する。過去の未変更Tripへ偽のcreatedイベントを生成せず、
既存データの初回同期は対象owner/Tripを承認したinternal reconcileで行う。生DynamoDB直書きは正規writerではない。
done/deadをTTLで削除しないため履歴は増える。保持整理は確認済みrecordの明示運用として別途設計する。

#393のwatch-subject索引はowner+subjectのまま。outbox GSIは特定Trip変更の配送専用であり、
共通TrainOperationから全ownerへfanoutする権限・索引ではない。#394/#409は外部Event runtimeにおいて
subject→認可されたowner/Trip routing索引、維持/CAS、鮮度、replay、fanout IAMを明示設計する必要がある。
「どこかでownerを列挙する」前提では完了としない。#408の地理/天候評価、#395の利用者通知も未実装のまま。

実装・運用・試験は[TripChanged配送](../architecture/trip-changed-delivery.md)を参照する。
