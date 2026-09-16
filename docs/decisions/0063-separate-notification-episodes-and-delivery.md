# ADR 0063: Impactから通知episodeと配信を分離する

- ステータス: Accepted
- 日付: 2026-09-17
- 対象: #395、親 #382 / #415、前提 #393–#409

## 現行との差分と決定

Impactはtyped factsを持つ独立resourceだが、通知状態・episode・配信host・通知一覧はない。
DomainのTripImpactに通知fieldを追加せず、NotificationPolicy / NotificationEpisode / Notificationを追加する。
LLMは一切呼ばない。既存Trip/Impact/Watch/Feasibilityの意味は変更しない。

初期channelはin-app centerとする。認証/公開writerが未配線の現状でWeb Push subscriptionやcredentialを
追加するより、owner-scopedな通知resourceと冪等Delivery portを先に完成させる。
公開hostは既存Tripと同じ認証gate内に留め、fake ownerで公開しない。

## 永続起動と最新状態

Impact保存後のsendはdual-writeになるため採用しない。DynamoDB Streamsは24時間retentionと
Trip/private行を含むstreamの管理が必要となる。既存DynamoDB transactionと共有due indexを採用する。
Impact保存と同じtransactionで、別notification tableにTrip/subject別の最新観測pointer（revisionを含む）を保存し、
decision待ちにする。外部Event全文やTrip本文はコピーしない。freshness/expiry/観測時点だけを
通知入力のenvelopeに残す。Impact IDからEventを復元・解釈しない。

旧観測はmonotonic order条件で現在pointerを巻き戻せない。同じsubjectの未処理観測は最新へcoalesceする。
未通知の短い過渡状態を全件配送する履歴キューではない。A→B→AでAのIDへ戻っても観測orderは別となる。
decision時はowner-scoped最新Tripと保存済みImpactを読み直す。通知commit時もTripと観測pointerをfenceする。
通知生成＋episode CAS＋delivery job＋decision ACKを同じtransactionにする。

## Policy

- informationalを通知しない。unknown/staleを解消としない。severityだけではなくtyped riskを必要とする。
- episodeはTrip revision＋subject/scope単位。同一episodeのrisk high-water markとseverityを比較し、
  既通知と同じ/弱いriskでは再通知しない。乗換余裕の段階悪化、必要時間割れ、予定超過の5分単位悪化を対象にする。
- weatherの数値の微小変化は通知理由にしない。hazardはquery-limited/有効期間不明を必ず明記し、施設危険を断定しない。
- freshかつuncertaintyのないrail no-impactで、action-requiredだったepisodeだけ解消候補にする。
  attentionだったrail episodeは閉じても解消通知しない。weather/hazardのno-impactやunknownは解消の証拠にしない。routes=0はそもそも入力にならない。
- revision変更でepisodeを引き継がない。保存済みImpactのevaluatedAtだけで現在の外部状態を保証しない。
- 対象予定の前日から終了までを初期通知windowとし、未知schedule/鮮度はunknown。

## 配信・UI・移行

通知作成と送信を分離する。in-app DeliveryはdedupeKey付きreceiptを冪等保存する。
claim lease / attempt / backoff / dead partition / operator CAS redriveを持ち、応答消失でも通知を増やさない。
送信直前にもTrip/episode/現在観測を確認し、古い警告を送らない。readはNotification自身のCASで更新する。
失敗でTrip/Impactをrollbackしない。permission未取得でもin-appは動き、monitoringの成功に影響しない。

一覧はowner限定・bounded paging。現在警告、未確認、過去revision/解消履歴を区別し、opaque Trip/item IDで移動する。
UIはtextContentで表示し、予約private・Provider raw・push secret・自由文を通知データへ入れない。
新tableのみで旧Trip/LocalStorage migrationなし。過去Impactは自動backfillせず、#409の新鮮な再評価から開始する。
Agent/Tool/Prompt/Context、公開認証、通知外channel、#396/#397は変更しない。

## 実装順と再利用

1. shared Domainのpolicy/template/validation（既存TripImpactFact/Trip/WatchSubject/時刻を再利用）
2. Backend port / owner repository / transactional decision signal（既存TripImpactRepositoryのtransactionを拡張）
3. 独立worker・Delivery port・retry/DLQ/IAM（既存shared tick方式を踏襲）
4. gated HTTP / 通知center / Trip navigation（既存TripWorkspace sourceを再利用）
5. Domain・SDK条件式・Application・UI・infra・Evalの検証
