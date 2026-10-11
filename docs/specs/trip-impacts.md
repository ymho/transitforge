# 鉄道TripImpact

親 #382/#415、契約ADR 0052/0058、判断 [ADR 0060](../decisions/0060-evaluate-rail-impact-through-internal-subject-routing.md)。

#408でrouting/Applicationを[Weather/Hazardと共通化](trip-impacts.md)した。
物理rail名は維持するが3種の内部Eventを扱う。rail評価policyそのものは変更しない。
通知への接続は#395の[Notification runtime](trip-notifications.md)で追加した。ImpactはTrip・予約・成立性の正本を変更しない。

## 内部利用

trusted hostは`createInternalRailImpact(table, metrics)`を使用する。

1. `ingest(subject, dateSpecificIndex, snapshot, sources, now)`で既存mapperを通すか、trustedで検証済みの
   rail-operation TravelEventを`process(event)`へ渡す。public inputやLLMを外部事実の正本にしない。
2. subject-only Queryがstorageのowner/Tripを解決する。callerがownerリストを渡す引数はない。
3. base Watch collection、owner worker、最新Trip、ReservationFactを読み、pure評価する。
4. 最新Tripを再GETし、同じTripを条件にImpactだけをtransaction保存する。
5. receiptはsaved/failed/skipped/routedTripsの件数とeventual/replayRequiredだけ。本文/private値を返さない。

LambdaはIAMで許可した内部hostからの同期RequestResponse用。source文字列を認証の代わりにせず、
公開route/function URL/resource-based public許可はない。配備と内部hostへのInvoke権限はInfrastructureが所有する。
既存のAgent HTTP Lambdaへ配線しない。`npm run build`で別bundleが生成される。

## 結果の解釈

typed factsはrail-delay、connection-buffer、schedule-risk、reservation-risk、rail-observation、uncertainty。
乗換はscheduled/required/projected分数とdepartureBasisを持つ。未知の次列車運行を定刻と断言する文面を作らない。
予約は既存の公開投影ReservationFactのreservationIdと固定時刻のみ。bookingReference/providerItemIdを扱わない。
reason codeは表示文ではない。通知の文面でもuncertaintyを消さず、予定基準のriskと確定事実を区別する。
現在のstation名しかないTrainIndexからPlace IDを作らず、地上移動・行先短縮は未確認になる場合がある。

Impact保存はTripとは独立し、no-impact/unknownも保持する。Repository.readは既知Impact IDのowner-scoped読み取りと
matchesTripRevisionを返す。これは現在のEvent/予約の選択や鮮度認定ではない。#395/#409は履歴から任意の古いImpactを
「最新」と選ばず、処理対象Event・policy・Trip revisionと観測鮮度を照合する必要がある。
同じ入力の再実行は同一ID/同一行（evaluatedAt metadataだけ更新可能）。異なる評価結果は履歴として残る。
保存直前のCAS競合はfailedとなり、最新Tripから再実行する。原本Trip/Reservation/Checklistは一切更新しない。

## 再投入・索引整合・観測

- GSI空結果でもglobal no-impactを生成しない。非空でも全件coverageの証明ではないため、常にreplayRequiredを返す。
- 同じEventの再投入は安全。古くなったEventはfreshフラグだけで使わずunknown。新しい観測の同じ状態は既存Event IDを再利用する。
- 1 owner失敗は別ownerへ波及させず件数を返す。Watch collectionの中間batchは既存complete=falseで不可視。
  #407のreconcile回復後に同じEventを再処理する。Watch同期やrollbackを独自に実装しない。
- 旧active Watchに新属性がなければ、次回reconcileが同じbatch/CASで補う。無更新の過去Tripは明示した対象の
  internal reconcileが必要。新索引だけで既存全件のrouting完了を主張しない。全owner Scanは行わない。
- metric: EventsReceived/RoutedOwners/RoutedTrips/Unknown/NoImpact/Impact/StaleRouting/StaleWatch/
  FanoutFailure/EvaluationFailure/PersistenceConflict/PersistenceFailure/FanoutLagMs/ReplayRequired。固定metricと数値のみ。
- Impactは無期限保持。再チェック・通知の実行は別の内部runtimeへ委譲する。

## 天気・警報TripImpact

正本は#382/#415、判断と制約は[ADR 0061](../decisions/0061-evaluate-weather-hazard-impact-with-shared-routing.md)。

[共有再チェックruntime](../operations/trip-rechecks.md)で[共有再チェックruntime](../operations/trip-rechecks.md)を追加した。
Provider IO・trusted target・bounded replayの現在の運用境界はそちらを参照する。
通知の最新観測選択・episode・配信は#395の[Notification runtime](trip-notifications.md)を参照する。Impactの意味やtyped factsは変更しない。

## 主要ファイルと内部利用

- Domain: `weather-event-fact.ts`、`weather-travel-event.ts`、`area-impact-schedule.ts`、`area-trip-impact.ts`。
- 既存変更: `travel-event.ts`、`trip-impact-fact.ts`、`weather-forecast.ts`の時間仕様コメント。
- Backend: `ports/trip-impact-routing.ts`、`adapters/dynamodb-trip-impact-router.ts`、
  `usecases/trip-impact-application.ts`、`usecases/trip-impact-evaluator.ts`。
- 既存`rail-impact-composition-root.ts`の`createInternalTripImpact`を内部hostから使用する。
  既存rail名のimportはre-exportの互換入口であり、第二実装ではない。

```ts
const runtime = createInternalTripImpact(tableName, numericMetrics);
// trusted resolver + provider callerが事前に得たscope/resultだけを渡す
await runtime.ingestWeather(target, forecastResult, observedAt);
await runtime.ingestHazard(query, hazardResult, observedAt);
// 正規化・検証済みEventをIAM内部Lambdaへ渡す場合
await runtime.process(event);
```

結果receiptの`failed`を見て再試行する。`routingCoverage=eventual`/`replayRequired=true`は常に維持する。
空routingは「全Tripに影響なし」ではない。索引からownerを発見し、owner/Tripのbase readと最新revisionを
再確認してから保存する。private値、owner、Trip本文はログ/metricへ入れない。
これらは内部seamであり、定期自動運転・Push・公開HTTP・認証導入を実装済みとしない。

## 解釈上の注意

weather-exposureは降水の直前1時間区間と、気温/weatherCodeのsampleAtを分ける。
windowには単独hourの交差と、降水unionに対する全配置の判定がある。予報欠測はunknownのまま。
dayは日付だけで、写真の屋外風景やActivity名から感受性を決めない。
hazard-exposureは検索区域と取得時点に関連する公的情報。施設包含・将来の有効性は未確認。
unknownは「問題なし」「営業確認済み」「安全」と表示しない。attentionも施設の実行不能を意味しない。

## 保存と互換性

Trip/legacy/LocalStorageのmigration、writer切替はない。Event永続storeも追加しない。
既存area Watchのrouting属性だけを同じreconcile/CASで補修する。物理`railSubject`/`rail-watch-routing`
を保持し、GSI置換や種類別追加をしない。既存area Watch未補修期間はrouting coverage未完了である。
schemaVersionやTrip.revisionを属性補修のために変更しない。#407の配送はそのまま。
既存無期限Impact履歴と250KB保存上限、2000facts上限は維持する。超過はfailure/retryとして扱い、
途中のfactを捨ててno-impactにしない。大規模Trip/forecastは後続hostで対象期間の分割を設計する。

## 公的ハザード事実の契約

親方針は #382/#415 と ADR 0052。ADR 0043の公的防災Toolを維持し、
`TravelAlert` を `HazardAlert` と明確化した。外部事実・計画・影響・通知を混ぜない。

## 正本と責務境界

- `HazardAlert`: JMA等の公的外部ハザード発表。公的severityはinformation/advisory/warning/emergency/unknown。
- `TravelEvent`: Provider非依存の現実世界のイベント。
- `TripImpact` (#393/#394): Eventを特定Tripの計画・revisionと照合した派生影響。
- `Notification`: 利用者へ何を届けたか、送信・既読・抑止等の独立状態。

`HazardAlertSeverity`にcritical/action-required等のTrip影響分類を入れない。
emergencyからTrip infeasible、通知criticalへの変換はない。HazardAlertはsent/read/notifiedAt/
notificationId/deliveryStatus/suppressed等を持たず、未知fieldとして拒否する。

## Domain・Wire契約

`modules/trip/domain/hazard-alert.ts`を唯一の契約にする。
旧型の別定義や互換aliasは不要だったため残さず、主要な内部利用箇所を同PRで移した。

- `HazardAlertQuery`: area（NFKC/trim後1〜80文字）、任意のcategory配列（最大7、既知enum・重複なし）、limit（整数1〜12、既定8）。
- `HazardAlert`: providerAlertId（opaque、1〜300）、category、severity、title（1〜160）、summary（1〜600）、issuedAt（valid instant）、issuer（任意1〜120）、sourceUrl。
- `HazardAlertSearchResult`: areaと最大12 alerts。areaは**検索対象**であり、正確な影響区域やTripとの交差の証明ではない。
- `HazardAlertProvider`: 既存`ExternalTravelProviderPort<Query, Result>`。
- `ExternalTravelInformation<HazardAlertSearchResult>`: available/unavailable/unknown、freshness、既存ExternalSourceEvidence、failureを維持。

共有validatorはDomain純粋関数。query/result/alert/envelope/source/failureの未知fieldを拒否し、
不正なcategoryやlimitを黙って削除・clampして成功させない。
URLはHTTPSかつcredentials/query/fragmentなし。既存`validateExternalSourceEvidence`の方針を再利用し、
危険なURLをquery削除で別URLに変えて証拠扱いしない。source metadataにも件数・文字数制限を設ける。

HTTPリクエストは引き続き`operation: "travel_alert_search"`。
応答は`{ alerts: ExternalTravelInformation<...> }`、Agent Tool名は`search_travel_alerts`のまま。
JSON field、status、severity enumの正常なwireは変えない。不正値は以前通っていても拒否する。
Frontend受信とBackend出力に同じvalidatorを使い、HTTP/Toolの所属queryとarea/category/limitも照合する。

取得成功・0件でも`data.area`は保持する。取得失敗は従来どおりdataなし＋failureであり、
呼出元のquery/Tool traceが検索範囲の正本になる。失敗から空のHazard factやEventを生成しない。
後続workerも結果単体ではなくqueryと取得結果を対として扱う必要がある。

## JMA Adapter

extra/eqvolの既存Atom feed、8秒timeout、各768KiB、1分cache、最大240の保持を維持。
warning/weather-information/typhoon/earthquake/tsunami/volcano/otherを維持する。
公的severityの分類は従来の発表本文の分類を維持し、Trip向けscoreへ変換しない。

XML rawをspreadせず保存可能fieldだけを明示構築する。タイトル・概要は表示用にboundedにするが、
opaqueなID/URLはtruncateやNFKCで別identityにしない。ID/URLの不正や必須値欠落はinvalid_response。
HTTP/片方のfeed失敗はunavailable。壊れたfeedを空の成功として扱わない。
cache再利用時は元のretrievedAtを保持し、検索時刻を新しい観測時刻として偽装しない。
5分のfreshnessは**取得したfeedの鮮度**であり、個々の警報の有効期限の保証ではない。

現Readerは既存JMA Atom subsetを対象とする。任意XMLの汎用parserや全電文readerを新設していない。
areaはtitle/summary/issuerの文字列照合であり、施設の地理包含、取り消し電文、未来の旅行日への影響を保証しない。
alertあり≠候補reject、空feed≠safe、未取得/unavailable/stale≠safeのままとする。

## Agent / Evidence / 評価

モデルにはarea（検索範囲）、status/freshness、最大12件のcategory/severity/title/summary/issuedAtと
最大24件のboundedな既存Source Evidenceだけを明示投影する。alertのopaque ID/issuer等は
後続Domain処理と表示用の取得結果に残すが、モデルの意思決定に不要なProvider値は送らない。
failureはcode/retryableだけ投影する。raw XML/巨大本文やProvider error本文は渡さない。

Tool descriptorに公的事実とTrip影響が別であること、未評価を断定しないことを記す。
固定質問順、Planner、常時Reflection、新しいmodel callを追加しない。
取得はread-onlyでありTripPatch、Checklist保存、Notification発火の入口を持たない。
準備提案が必要なら既存ChecklistProposal→preview→利用者確認を使い、done/not-neededは維持する。

既存A〜AHの値とthresholdを変更せず、AI-hazard-not-impactを追加した。
production Runtime/registry/Context/Evidenceを通し、ProviderとモデルIOだけを合成する。
AIは公的emergencyとEvidenceの提供、Trip/予約/Checklist/Feasibility不変、別Actionなしを検証する。
scripted model/tool callは2/1。新旅程生成の依頼ではないためTTFC/TTFIはnullであり、0に偽装しない。
Smokeは19件、Fullは35件のTrip Progress（保存済み観測12/42、Ask + Progress 2/7は維持）。

scriptedの説明文はモデル品質や現実の遅延の証明ではない。全自由文の意味的なgroundingは
既存Claim検証だけでは保証されない。Live Evalは既存のAWS認証期限切れの記録を維持し、本変更では実施しない。
認証更新後の再確認は`npm run eval:agent:decision:live -- --suite trip-progress --profile full`を使う。
