# 通知の停止と観測ストレージ

旅行通知は提供しない。設定・サイドバーの通知入口、通知センター、Browserの通知HTTP client、list/readのHTTP handlerと公開ルートは撤去する。旧通知パスは公開APIに含めず、個人API hostでも404を返す。保存操作の完了を伝える画面内の一時メッセージは、旅行通知とは別のUIとして維持する。

## 定期配信の停止

通知のEventBridge ruleは`DISABLED`、Lambdaの`NOTIFICATION_ENABLED`は`false`とする。Lambda自身も有効化されていない場合は、通知作成・配信・DynamoDB読み書きを実行しない。停止中に意図した停止を障害と扱うheartbeat alarmは配置しない。公開の起動・再送・既読APIはない。

## 残す内部依存

通知用DynamoDB tableは、TripImpact保存と同じtransactionで最新観測のSIGNALを保存するためにも使う。rail-impactとtrip-recheckのProducer、InTripContextの観測Readerはこのストレージへ依存する。通知がなくても、Impactの現在性・鮮度を判定する観測pointerが必要なため、table・書込権限・観測処理を削除しない。

NotificationPolicy・episode・delivery workerと既存データは、配信を停止した内部実装として保持する。公開能力として扱わない。完全撤去には、最新観測projectionを通知配信のPort・Adapter・ストレージから分離し、InTripContextの通知projectionも外す必要がある。tableの削除や既存データの移行は通知入口の撤去と一緒に行わない。

Trip / Impact / Watchの正本・revision・CASは変更しない。既存観測のowner境界、鮮度検証、monotonic order条件も維持する。通知を止めても旅程の運行・天気確認の安全性を保証したことにはならない。
