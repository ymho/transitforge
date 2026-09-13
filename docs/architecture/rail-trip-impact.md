# 鉄道TripImpact (#394)

親 #382/#415、契約ADR 0052/0058、判断 [ADR 0060](../decisions/0060-evaluate-rail-impact-through-internal-subject-routing.md)。

## 現行 → 今回

| 境界 | 再利用 | #394の追加 |
| --- | --- | --- |
| 計画 | Trip / SelectedRailJourney / ItinerarySchedule / Place identity | 変更なし。scheduledとrealtimeは別 |
| 外部観測 | railTravelEvent、dated binding、TravelEvent ID、ExternalSourceEvidence | 変換モデルを増やさずApplication ingestから使用 |
| Watch | projection/diff/owner repository/collection CAS/reconcile | active railSubject属性＋内部KEYS_ONLY GSI、旧行の同じreconcileでの補修 |
| Worker | TripWatchWorker.process、ReservationFact reader、最新Trip検査 | subjectから解決したprincipalごとに呼ぶfanout Application |
| Impact | 既存TripImpact/validator/identity | policyVersion、typed facts、pure rail evaluator、owner-scoped保存 |
| 公開範囲 | public writer/認証gate OFF | 別internal Lambdaのみ。Agent/Browser/通知には未接続 |

主なコードはDomainの`rail-trip-impact.ts`、`trip-impact-fact.ts`、既存`trip-impact.ts`、
Backendの`rail-impact-application.ts`、`rail-trip-impact-evaluator.ts`、routing/persistence Adapter、
`rail-impact-composition-root.ts`/`rail-impact-lambda.ts`。infraは`rail-impact.tf`とTrip GSI/packaging。

## 内部利用

trusted hostは`createInternalRailImpact(table, metrics)`を使用する。

1. `ingest(subject, dateSpecificIndex, snapshot, sources, now)`で既存mapperを通すか、trustedで検証済みの
   rail-operation TravelEventを`process(event)`へ渡す。public inputやLLMを外部事実の正本にしない。
2. subject-only Queryがstorageのowner/Tripを解決する。callerがownerリストを渡す引数はない。
3. base Watch collection、owner worker、最新Trip、ReservationFactを読み、pure評価する。
4. 最新Tripを再GETし、同じTripを条件にImpactだけをtransaction保存する。
5. receiptはsaved/failed/skipped/routedTripsの件数とeventual/replayRequiredだけ。本文/private値を返さない。

LambdaはIAMで許可した内部hostからの同期RequestResponse用。source文字列を認証の代わりにせず、
公開route/function URL/resource-based public許可はない。Terraform applyとhostへのInvoke権限付与は本作業では行わない。
既存のAgent HTTP Lambdaへ配線しない。`npm run build`で別bundleが生成される。

## 結果の解釈

typed factsはrail-delay、connection-buffer、schedule-risk、reservation-risk、rail-observation、uncertainty。
乗換はscheduled/required/projected分数とdepartureBasisを持つ。未知の次列車運行を定刻と断言する文面を作らない。
予約は既存の公開投影ReservationFactのreservationIdと固定時刻のみ。bookingReference/providerItemIdを扱わない。
reason codeは表示文ではない。将来#395が文面を作る際もuncertaintyを消さず、予定基準のriskと確定事実を区別する。
現在のstation名しかないTrainIndexからPlace IDを作らず、地上移動・行先短縮は未確認になる場合がある。

Impact保存はTripとは独立し、no-impact/unknownも保持する。Repository.readは既知Impact IDのowner-scoped読み取りと
matchesTripRevisionを返す。これは現在のEvent/予約の選択や鮮度認定ではない。#395/#409は履歴から任意の古いImpactを
「最新」と選ばず、処理対象Event・policy・Trip revisionと観測鮮度を照合する必要がある。
同じ入力の再実行は同一ID/同一行（evaluatedAt metadataだけ更新可能）。異なる評価結果は履歴として残る。
保存直前のCAS競合はfailedとなり、最新Tripから再実行する。原本Trip/Reservation/Checklistは一切更新しない。

## Replay・migration・観測

- GSI空結果でもglobal no-impactを生成しない。非空でも全件coverageの証明ではないため、常にreplayRequiredを返す。
- 同じEventの再投入は安全。古くなったEventはfreshフラグだけで使わずunknown。新しい観測の同じ状態は既存Event IDを再利用する。
- 1 owner失敗は別ownerへ波及させず件数を返す。Watch collectionの中間batchは既存complete=falseで不可視。
  #407のreconcile回復後に同じEventを再処理する。Watch同期やrollbackを独自に実装しない。
- 旧active Watchに新属性がなければ、次回reconcileが同じbatch/CASで補う。無更新の過去Tripは明示した対象の
  internal reconcileが必要。新索引だけで既存全件のrouting完了を主張しない。全owner Scanは行わない。
- metric: EventsReceived/RoutedOwners/RoutedTrips/Unknown/NoImpact/Impact/StaleRouting/StaleWatch/
  FanoutFailure/EvaluationFailure/PersistenceConflict/PersistenceFailure/FanoutLagMs/ReplayRequired。固定metricと数値のみ。
- Impactは無期限保持。今回Notification配信、Event永続配送、定期recheckや全transport realtimeを実装済みとはしない。

## AC自己レビューと試験

| AC | 確認箇所 |
| --- | --- |
| ownerなしsubject→複数owner/Trip、no Scan、base再検証 | rail-impact-application.test / rail-impact-dynamodb.fixture / infra test |
| inactive/partial/stale/archive/terminal/索引空/偽owner | Application/Adapter tests |
| 日付/UID一意binding、unknown/unavailable/stale、0捏造なし | 既存travel-event tests＋Domain/ingest tests |
| uniform delay、乗換buffer、severityが計画依存 | rail-trip-impact.test |
| fixed/window/day/unscheduled、samePlace/異地点 | 同上。名前だけの同一視をreject |
| booked固定矛盾/時刻不明/private拒否/reader失敗 | DomainとApplication tests |
| 明示運休のみ、行先identity未確定、long-stop非critical | Domain tests |
| independent owner保存、重複/応答消失/Trip race/履歴 | Application+SDK transaction contract fake |
| 計画/予約/Checklist/Feasibility不変、通知なし | Domain入力不変、storage namespace不変、infra negative tests |
| 既存Agent品質維持 | Smoke/FullのA〜AIと保存済みケース。Runtime/Context/閾値変更なし |

SDK fakeはDynamoDB実サービスの検証ではない。infra静的testとTerraform validateもIAM実行確認の代替ではない。
全test/build/architecture/workspace/Smoke/Full/infra/fmt/validate/diffの実行結果をPRへ記録する。
Agent未変更なのでLive Evalは追加実行しない。従来のAWS認証期限切れによる未実施記録は維持する。

最終ローカル確認: TypeScript 2,062件（frontend/shared 1,717、backend 345）、Python 24件が成功。
Smokeは保存済み12/Ask 2/Trip Progress 19、Fullは42/7/35で全件成功した。
build、architecture/workspace、bundle/Lambda、Terraform fmt/validate、git diff --checkも成功。
Terraform providerのローカル起動にはsandbox外の実行が必要だった。既存hash_key等の非推奨警告は残る。
AWSへのapply、実IAM/実データの疎通、運行Eventの自律収集や通知は実行していない。
