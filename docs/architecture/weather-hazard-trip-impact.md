# 天気・警報TripImpact (#408)

正本は#382/#415、判断と制約は[ADR 0061](../decisions/0061-evaluate-weather-hazard-impact-with-shared-routing.md)。

後続#409で[共有再チェックruntime](trip-recheck-runtime.md)を追加した。以下の未配線事項は#408導入時の記録であり、
Provider IO・trusted target・bounded replayの現在の運用境界はそちらを参照する。
通知の最新観測選択・episode・配信は#395の[Notification runtime](notification-runtime.md)を参照する。Impactの意味やtyped factsは変更しない。

## 現行 → 実装 → 後続

| 境界 | #408の実装 | 残す責務 |
| --- | --- | --- |
| 単点WeatherEventFact | 同じTravelEventへbounded hourly/timezone/座標/query range/time basisを保持 | #409の取得・期間分割・再チェック |
| HazardAlert/Event | mapperは再利用。query-limited、地理/有効期間unknownを保持 | 構造化対象区域/期間が将来提供される場合の拡張 |
| rail専用routing | TripImpactRouter/Applicationへ共通化。同じ物理GSI・Lambdaを使用 | #409の再投入、coverage完了運用 |
| rail typed facts | weather-exposure/weather-placement/hazard-exposure/uncertaintyを同じunionへ追加 | #395/#396の説明・表示 |
| Impact保存 | #394のRepository/CAS/owner分離/履歴をそのまま利用 | 通知・履歴の最新選択policy |
| Activity sensitivity | 任意の小さいverified入力。未提供時は支障unknown | trusted resolver、taxonomy追加ではない |

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

## Migrationと互換性

Trip/legacy/LocalStorageのmigration、writer切替はない。Event永続storeも追加しない。
既存area Watchのrouting属性だけを同じreconcile/CASで補修する。物理`railSubject`/`rail-watch-routing`
を保持し、GSI置換や種類別追加をしない。既存area Watch未補修期間はrouting coverage未完了である。
schemaVersionやTrip.revisionを属性補修のために変更しない。#407の配送はそのまま。
既存無期限Impact履歴と250KB保存上限、2000facts上限は維持する。超過はfailure/retryとして扱い、
途中のfactを捨ててno-impactにしない。大規模Trip/forecastは後続hostで対象期間の分割を設計する。

## AC自己レビュー

| 要求 | 根拠・テスト |
| --- | --- |
| hourly正規化/zone/時刻順/重複/bounds/値検証 | weather-travel-event.test、DST fold/gap/fractional zoneも検証 |
| Evidence/stale/unavailable/out-of-range/semantic dedupe | weather-travel-event.test + area-trip-impact.test |
| fixed/window/day/unscheduled | area-trip-impact.test、window union definite/possible/none、明示zoneの日付交差 |
| sensitivity有無・閾値だけで重大度を決めない | verified入力/期限切れ/未検証拒否/極端な数値のテスト |
| Hazard scope/空feed/自由文/emergency | area-trip-impact.test、query-limited/validity unknown維持 |
| 複数owner/Trip、別区域、stale/inactive/partial、no Scan | area-impact-application.test、既存rail routing試験も維持 |
| store再利用/owner分離/重複/応答消失/revision race/旧履歴 | area-impact-application.test + 既存Repository/rail試験 |
| 原本・予約・準備・通知・Agentを変えない | 保存前後全record比較、strict facts、Python infra negative checks、既存Smoke/Full |

Live EvalはAgent変更なしのため追加しない。既存のAWS認証期限切れで未実施の記録は維持する。
実AWSへのapply、Provider実接続・IAM実環境統合は未実施。SDK fake/静的infra試験と区別する。

最終ローカル確認: TypeScript 2,118件（frontend/shared 1,760、backend 358）、Python 25件成功。
Smokeは保存済み12/Ask 2/Trip Progress 19、Fullは42/7/35で成功。
build、architecture/workspace、bundle、lambda、Terraform fmt/validate、diff checkも成功。
Terraform validateにはProvider起動のローカル通信許可が必要だった。既存hash_key/range_key非推奨警告は残る。
