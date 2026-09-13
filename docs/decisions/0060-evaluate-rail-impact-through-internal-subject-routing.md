# ADR 0060: 内部subject逆引きで鉄道観測をTripImpactへ評価する

- ステータス: Accepted
- 日付: 2026-09-14
- Issue: #394、親 #382 / #415、前提 #386 / #393 / #407 / #413

## 現状と選択

#393の`watch-subject`はowner+subjectの索引であり、共通の運行Eventからownerを発見できない。
#407のoutboxはTrip変更の配送専用で、運行Eventのfanoutやowner一覧ではない。

subject partitionのrouting recordを別に維持する方式と、既存Watchのsparse GSIを比較した。
後者を採用する。独立record方式には既存Watch diffと別の二重write/回復契約が必要になるためである。
`railSubject = SHA256(canonical dated subject)`をactive rail Watchにだけ付け、`rail-watch-routing`を
KEYS_ONLYにする。Watchと属性の更新は既存のTrip ConditionCheck + collection CAS/batchで同時に行う。
Domain Watch ID、owner内索引、complete=falseからの回復、reconcileを再実装しない。

[GSIの疎な索引・結果整合・KEYS_ONLY](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.html)を前提とする。
索引から得たpk/skはヒントだけで、owner-scopedなbase collectionを一貫性再読込しactive/complete/revision/subjectを検証する。
さらに既存TripWatchWorkerが最新Trip/Watchを照合する。ownerをイベントbodyから取らず、全owner列挙/Scanもしない。
新規Watchが両GSIへ見えるまでの遅れは消せないため、空/非空いずれのreceiptも`routingCoverage=eventual`と
`replayRequired=true`を返す。未hitをno-impactへ変換しない。同じEventの再実行と、新鮮な観測の再ingestが可能。

## 計画と現実の分離

Domainの`evaluateRailTripImpact`をBackendの既存TripImpactEvaluator portへ適合させる。
入力はTrip、TravelEvent、matching Watch、ReservationFact、Clockの時刻だけ。AI、Provider IO、通知を呼ばない。
計画・予約・Checklist・planned Feasibilityはread-only。Eventは既存railTravelEventで日付別TrainIndexへ一意bindingする。
内部Lambdaは検証済みTravelEventを直接受けるseamであり、任意HTTP callerの事実登録APIではない。

### rail-service-delay-v1

- Eventがobserved/freshで、観測後5分以内、未来でなく同じ業務日、observed Evidenceが有効な場合だけ遅延を使う。
  5分は既存operation tolerance。failed/unknown/stale、UID未解決、番号/日付不一致はunknown。欠測を0にしない。
- 同一serviceの観測delayを、そのserviceの採用済みlegのscheduled departure/arrivalへ一様加算する。
  駅別の回復や追加遅延、他serviceの遅延は推測しない。IANA zoneを保持し日跨ぎ/DSTをinstantで計算する。
- 同じjourneyの乗換は採用済み`minimumTransferMinutes`と比較。scheduled bufferとprojected bufferを両方保持する。
  次legが同じ観測serviceでなければdepartureBasisはscheduledであり、「次列車が実際に定刻」「乗換不能確定」ではない。
- 必要乗換時間割れはaction-required。必要分数を除いた余裕が元の半分以下に減った場合はattention。
  これは予定余裕との相対比較であり、「遅延20分」等の遅延分数単独thresholdではない。
- 後続予定は採用順。投影到着がfixed開始/所要時間を引いたwindow最遅開始を越えれば、移動0分でも衝突するrisk。
  window内の配置が可能なだけならunknown。day/unscheduledを固定時刻にしない。
- 直後のfixed予定への到達を移動0分で扱えるのは既存samePlaceIdentityが成立するときだけ。
  別地点・名前のみ・後続の中間予定/移動が未証明ならunknown。未観測の乗継列車を捕まえた仮定で最終到着を推測しない。
- booked ReservationFactの後続itemに明示startsAtがあり投影到着と矛盾すればappointment risk。
  未取得の時刻/unknown状態は未確認。reader失敗は評価失敗として再実行し、空リストへ置換しない。
- trusted observed cancelled=trueだけaction-required。現行TrainOperationには明示運休fieldがないので
  既存mapperは欠落から運休を作らない。将来のtrusted sourceの明示Eventは同じ契約で受ける。
- destinationは現在文字列だけ。Eventには終着stopのidentity/indexがなく、採用legの降車駅は列車終着とは限らない。
  既知の駅名でも到達不能を証明せずdestination_identity unknownを残す。long-stop単独ではinformationalとし、
  severityを上げるのは具体的な乗換・予定への影響を計算できた場合だけとする。
- 初期policyはcriticalを出さない。既知riskがあればimpactを返し、同時に存在するunknownもtyped factsへ残す。
  未確認だけならunknown/informational、証明範囲に具体的な破綻がなければno-impact/informational。
  no-impactも「旅行の全リスクがない」という保証ではない。

## 保存とIAM

TripImpactへpolicyVersionとstrictなtyped factsを追加する。自由文、raw response、private booking値、通知状態を拒否する。
既存Event IDは意味上の状態identityを維持。Impact IDはTrip ID/revision、Event ID、policy、判断/測定値から決定的に生成し、
評価時刻はidentityに入れない。Reservation等の追加入力が変わり判断が変われば別の派生結果として履歴に残す。

owner PKの`IMPACT#tripId#hash(impact.id)`へstorageVersion=1で保存する。同じ評価を再実行しても行は増えない。
保存前に最新Tripを再GETし、transaction内でもactiveとTrip JSONの一致をConditionCheckする。
既存legacy envelopeにrevision属性がなくても同じguardが動く。保存成功後のTrip変更は旧Impactを履歴にする。
readのmatchesTripRevisionはTripとの一致のみで、最新外部観測・予約・鮮度の保証ではない。
再評価でTrip snapshotを更新せず、過去Impactを新revisionへrebaseしない。保持は無期限、運用上の容量管理は必要。

[transaction IAM](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis-iam.html)に沿い、
専用Lambda roleだけにsubject索引Queryを与える。Agent roleと#407 pollerには与えない。
tableはGet/Query/ConditionCheck、Putはtransaction内のImpact envelope属性に限定する。
Update/Delete/Scan、Bedrock、通知権限は不要。public endpoint、関数URL、AgentからのInvoke grantは追加しない。
CloudWatchは固定名と数値のmetricのみで、owner/Trip/Reservation/raw例外を記録しない。

## 導入と残す責務

既存Trip/Reservation/LocalStorageのmigrationなし。#393ではImpact永続化が未導入なのでImpactレコードの移行もない。
既存active WatchのrailSubject欠落は読み出せるまま、次の既存reconcileの同じCAS batchで補う。
旧Tripを初回同期する場合は#407同様、明示したowner/Tripに内部reconcileを実行する。
索引追加だけで過去の全Watchを移行済みとはしない。既存稼働データの対象を確認してから内部hostを有効化する。

今回はApplicationとIAM-only RequestResponse Lambda seamまで。自律的な運行収集トリガー・Event配送store・
全件coverageの完了認定は追加しない。hostはfailed/replayRequiredを処理し、timeout/応答消失後も再実行できる。
元Eventが古くなればunknownとして評価し、定刻へ戻さない。#409が新鮮な共通観測の再投入・定期再検査を担う。
GSIは最大100page/10000候補行を読み、超過を切り捨てず失敗する。大規模fanoutの継続cursor/分割配送は将来拡張。
#408は天候/警報、#395は通知resource・最新Event/episode・dedupe/配信、#397はAI再計画を担当する。
Agent/Tool/Prompt/Context、public writer gate、#407のoutbox配送は変更しない。
