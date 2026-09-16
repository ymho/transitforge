# ADR 0062: 共有due-workでTrip再チェックを起動する

- ステータス: Accepted
- 日付: 2026-09-17
- Issue: #409、親 #382/#415、前提 #393/#407/#394/#408

## 現行と不足

TripChangedのtransactional outbox、Watch projection/CAS、subject-only routing、Event mapper、
決定論的Impact評価、revision-fenced保存は導入済み。自律的Provider取得、時刻起動、trusted area resolver、
eventual routingのreplay hostはない。これらの既存実装は再実装しない。

## 比較と決定

| 方式 | 判断 |
| --- | --- |
| Tripごとの毎分Scheduler | 高cardinality、更新/取消の二重管理。採用しない |
| 未来taskを全件キューへ投入 | 長期due/reschedule/dead履歴の別正本が必要。採用しない |
| 共有tick + 固定shardの永続due index | 既存DynamoDB/Lambda/EventBridgeで実装でき、長期停止でもtaskを失わない。採用 |

専用の暗号化/PITR tableにowner PKとtask IDのhash SKを置く。Trip tableのAgent権限を継承させない。
`recheck-due`は4 shard、KEYS_ONLY、各tick最大5件/shard、Scanなし。due recordは消さず次tickで続行する。
1本のEventBridge tick、worker180秒/concurrency1、claim lease240秒。新規claimは残65秒未満で止める。
長いProvider/DB処理でtimeoutになってもleaseとattemptが残る。

TripChanged consumerは既存Watch reconcileを委譲実行し、最新Trip/complete Watchからtaskをensureしてから
outboxをACKする。Watch成功後task保存失敗でもoutbox再処理で回復する。Watch同期や差分/CASは複製しない。
taskは別projectionなのでTripと同時更新ではないが、投影完了前のsignalを消さず、best-effort dual-writeにしない。
taskのstable identityはTrip ID/revision/kind/watch ID/policy。同じensureはlease/dead/inactiveをresetしない。

## 時刻policyと外部IO

`trip-recheck-v1`はProvider horizonへ入ってから取得する。[Open-Meteoの16日horizon](https://open-meteo.com/en/docs)
に合わせ、現地当日〜15日後だけ取得する。長期予定を最大6暦日ずつ、最大3chunkに分ける。
6日はDSTの25時間日を含んでも168sample以下に収める余裕。既存mapperの件数/時刻/Evidence検証は緩めない。
weatherは遠方6時間、1週間内1時間、前日/当日30分。hazardは前日から1時間、予定期間中5分。
railは予定1時間前から2分で共通collectorの保存済み観測を再投入する。鉄道APIは呼ばない。

日付精度はscheduler envelopeとしてのみ保守的に扱い、Tripのdayを時刻へ書き換えない。
unscheduledはunknown/retry。区域解決待ちの`readiness` taskは既存Watch再投影専用で、
Checklist/Reservation/Feasibilityの更新やready認定を行わない。

weather targetは保存済みPlaceの座標/timeZone/取得時点/非unknown Evidenceから解決する。
subjectは座標+zoneのopaque hash。施設名は表示ラベルだけでgeocodingへ送らない。
hazardは内部S3 catalogのPlaceRef→query areaの明示bindingとdurable sourcesを使う。
同名/近隣やPlace.areaから推測しない。ID不一致/重複binding/証拠不足はunknown、解決taskでbounded retryする。
catalog IO障害は既存Watchを空集合へ置換せず投影全体をretryする。

Provider IO後は既存weatherTravelEvent/hazardTravelEvent/railTravelEventだけで正規化する。
railは日付別direct-service indexのidentity allowlistと共通S3 snapshotを同じpoll内で共有する。
欠落/曖昧/古い観測を0遅延や運休へ変換しない。HTTP失敗は成功Eventを生成せず、既存Impactを安全へ戻さない。

## Revalidation、replay、障害

taskにTrip本文/owner/Provider target snapshotを入れない。ownerはprivate tableのPKから得る。
毎回最新Tripとcomplete/active WatchをGETし、fetch後にも再確認する。旧revision/terminal/archive/missingはinactive。
旧taskがWatchを再activationすることはない。Impact保存は既存transactional revision fenceを維持する。

[GSI結果整合](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.html)は完了証明できない。
`replayRequired=true`を受け、初回・60秒後・さらに120秒後の3passを永続checkpointし、新鮮な観測を再取得して投入する。
同一Eventに固定せずfresh observationを使い、source鮮度を偽装しない。非空結果でも後続passを省略しない。
全pass後もroutes/saved=0ならrouting_lagとして再試行し、15分window超でdead。途中失敗も最大8attemptでdead。
非空の3pass成功後は通常cadenceへ戻るが、coverage完了/全Trip無影響とは認定しない。

Provider timeout/rate limit/unavailable/invalid response、partial fanout failure、応答消失は30秒から指数backoff、最大30分。
claim時にattemptを保存するためcrashも上限に含む。poisonはtask本文を残さず隔離する。
本体DLQはtableのdead partitions、無期限・自動redriveなし。operator CAS redriveだけを提供する。
tick配送失敗用のSQS DLQは別で14日保持。本体taskの寿命には影響しない。

## 境界・導入

公開HTTP/Function URL/Agent toolを追加しない。IAMはtask table、既存Watch/Impact transaction、必要なS3 keyに限定する。
Trip/private Reservation/raw payload/ownerをログへ出さず、固定EMF名と数値だけを記録する。
Trip JSON/LocalStorage/writer gate/Agent/Prompt/Contextに変更なし。Pushと通知dedupeは#395。
過去の未変更Tripの初回投影は承認したowner/Tripへ内部reconcileを実行する。全owner Scanはしない。
運用手順、必要catalog、残るunknown、テストは[再チェックruntime](../architecture/trip-recheck-runtime.md)を参照。
