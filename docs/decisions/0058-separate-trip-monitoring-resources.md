# ADR 0058: Tripの計画と監視・外部イベント・影響を分離する

- ステータス: Accepted
- 日付: 2026-09-13
- Issue: #393、親 #382 / #415

## 決定

同じTripを計画の正本として維持し、TripWatch / TravelEvent / TripImpactを別契約とする。
既存SelectedRailJourney、ItinerarySchedule、ExternalSourceEvidence、TripPrincipalを再利用する。
Trip、Reservation、Checklist、Feasibility、Agent Runtimeに観測値や通知状態を書き込まない。

- Watchは保存済みTripから決定論的に生成する。IDはTrip/item/dated subjectから安定生成する。
  railはserviceDate+UID優先、UID不在時のみserviceDate+trainNumber。名前を照合キーにしない。
- 外部の監視区域はtrusted resolverの入力だけを扱う。Place名や要求文から区域を推測しない。
- scheduleのfixed/window/day/unscheduled精度をWatchにも保持する。日付を固定時刻へ変換しない。
- 同じ暗号化DynamoDB tableにowner-scoped Watchと同期metadataを置く。
  active Watchだけに`watchSubject`を付け、owner+subjectのSHA-256をpartitionにしたsparse GSIを追加する。
  GSIはKEYS_ONLY。Query後にbase tableの集合を一貫性読込し、同期versionが読込前後で変われば拒否する。
- 差分を最大98件ずつ、保存済みTripの条件確認＋Watch集合CAS＋差分書込のtransactionで進める。
  中間batchはcomplete=false。全差分の完了までworkerの逆引き結果へ公開しない。
  保存済みTripは書き換えず、sync失敗でrollbackしない。再処理は最新Tripと実際のWatch差分から再開する。
- TravelEventは観測metadataと意味上の状態identityを分ける。同じ状態の取得時刻/Evidence ID更新で
  event identityを増やさず、状態/freshness変更は別identityにする。raw Provider値を保存しない。
- TripImpactはTrip revision/event/affected itemに結びついた派生結果。影響評価・通知は別担当。
  未実装のevaluatorを「影響なし」で代替しない。

## 代替案と判断理由

Tripへdelay/alertSentを追記すると計画と現実・配信状態が混在する。全Watch Scanは所有者分離と
検索負荷の点で採用しない。逆引き用の二重手動writeより、同じtableのsparse GSIを選ぶ。
索引への反映は結果整合なので、最新TripとWatchを再照合し、索引のpayloadをそのまま信用しない。

全Watchを毎回削除・再作成せず、同じIDとinactive履歴を残す。単一transactionの件数上限で
正当なmulti-leg Tripを切り捨てないためbatchと公開markerを分ける。中間状態の間は一時的に
監視対象を返さない安全側の停止となる。確実な再配送・再評価は#407/#394が担う。

AWSの[transaction制約](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html)と
[GSIの結果整合・projection](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.html)を確認した。
新サービス/frameworkは不要。費用増分はactive Watchの索引保管とQuery/再読込、差分transactionである。
[transactionのIAM契約](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis-iam.html)に従い、
Trip tableに限定したConditionCheckItem権限を追加する。PutItem権限だけでConditionCheckが動くとは仮定しない。

## 公開・migration・後続

新しいstorageVersion=1のWatch namespaceのみ。既存Trip JSON/LocalStorageのmigrationやdual-writeなし。
公開writerはOFF。既存main LambdaへWatch handlerや認証の仮実装を配線しない。

#407がStreams/outboxと確実なsync起動・retry/DLQを選定する。本PRは配送を実装済みとしない。
#394/#408が決定論的Impact評価、#395が通知・episode/dedupe・配送、#396/#397が旅行中Context/replanを担う。
契約・制限・試験は[Trip monitoring](../architecture/trip-monitoring.md)を参照する。
