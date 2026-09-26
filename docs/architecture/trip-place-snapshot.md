# Trip V2 Place契約の導入 (#414)

正本は #382 / #415、[ADR 0052](../decisions/0052-establish-trip-v2-contract-and-migration.md)、
[Trip lifecycle](trip-lifecycle.md)。main `9053587`（#420マージ後）の実装を確認した。
検索の地点同定は#377、選択後に保持するvalue objectは#414が所有する。

## 現在 → 今回 → 後続

| 現行表現 / 利用箇所 | 今回の扱い / 後続 |
| --- | --- |
| `SightseeingPlanItem.place` (`trip-plan.ts`) | legacy name/provider/placeId/`[longitude, latitude]`を維持。#404のreader契約を変更せず、単一converterからPlaceSnapshotへ変換。Activity自体は#410 |
| `ScheduledRailLeg.origin/destination` | `{ name }`をPlaceSnapshotへ統合。時刻表に駅の永続IDがないためrefを発明しない。日付/UID/番号/stop indexによる鉄道同定は維持 |
| `StayItineraryItem.selection.accommodation.place` | 最小宿の名前をPlaceSnapshotへ統合。unselectedにも任意placeを許し、名前だけの手入力を確定宿扱いせず保持できる |
| `TravelCandidate` / `AccommodationOffering` / `TripAccommodation` | 比較・legacy応答のまま。Provider/providerItemId、name、address、areaName、緯度経度、価格/写真/評価は保存許諾ではない。候補採用usecaseでPlace部分だけ許可リスト変換。宿全体の最終整理は#400 |
| `MapboxPlaceMediaProvider` / `PlaceMedia` | opaqueなmapbox_idをproviderPlaceIdへ写す検索Adapter。名前・座標・カテゴリ・営業時間・評価・sourceUrlはruntimeの検索結果。#377のmatching/dedupは変更しない |
| Wikipedia / enriched / image `PlaceMediaProvider` | page ID、写真、説明、複数ソース、取得日時/期限を持つruntime応答。画像利用可否とTrip保存許諾は別。検索単位EvidenceやMapboxホームページURLだけで個別施設の保存許諾を証明しない |
| `RestaurantCandidate` / Hot Pepper Adapter | providerRestaurantId、任意mapboxPlaceId、位置・営業・価格等のruntime候補。Provider間IDを同一視せず#410で同じPlaceSnapshotを採用 |
| `GroundAccessRoute` / Matrix等 | 現在は検証済み検索地点を使うruntime移動結果。#402/#413でTripのPlaceSnapshotの位置/identityを照合して利用。Placeへ移動時間を保存しない |
| `agent-context-snapshot.ts` | V2の宿名・鉄道発着名を既存と同じbounded projectionで読む。Place全体やsource/IDを追加送信しない。currentTrip/candidates/realtimeFactsの意味は不変 |
| `PlaceMedia` / `RestaurantCandidate` 等のruntime候補 | 相談・旅程のpresentationへ投影する一時データ。運行地図には観光候補用の別projectionを持たず、V2の正本や保存形式にはしない |

## 唯一の保存可能モデル

`modules/trip/domain/place-snapshot.ts`の`PlaceRef`と`PlaceSnapshot`を公開する。

- Ref: `provider`、任意`providerPlaceId` / `canonicalKey`。providerはnamespace、IDは非空opaque文字列。
  IDの正規化・切詰め・名前からの生成はしない。canonicalKeyは同定側が既に解決した値だけ。
- Snapshot: `ref?`、必須`name` / `sources`、任意`address` / `coordinate` / `area` / `timeZone` / `capturedAt`。
  coordinateは`{ longitude, latitude }`で、有限かつ±180/±90以内。名称は非空、timezoneはIntlで有効性を検証。
- `samePlaceIdentity`は同じProvider内の解決済みIDの等値比較だけ。両方にproviderPlaceIdがあればそれを優先し、
  異なるIDをcanonicalKeyで潰さない。名前・座標・manualはこの比較で同一と認定しない。
  identity不明は「別施設である証拠」でもない。検索ランキングや位置近傍matchingは実装しない。
- 名前だけのmanualは`{ name, sources: [] }`またはmanual ref。座標なしでも有効だが経路/天候結合可能とはしない。
  manual refにProvider ID/canonicalKey/外部Evidenceを付けてverifiedな施設と偽装する構造は拒否する。
- 外部値は同じ`ExternalSourceEvidence`を利用し、別Evidence型は作らない。runtime idに加えて恒久的な
  sourceIdまたは公開sourceUrlとprovider/取得日時を要求する。refがなくても時刻表等の出所は保持できる。
  refがあれば同じProviderの出所が必要。confidence=unknownをobservedへ昇格させない。
- 保存用sourceは既存Evidence fieldの許可リスト。attribution/観測日時/有効期間を提供された範囲で保持する。
  sourceUrlはHTTPSの公開参照だけとし、認証情報・query・fragmentを含む取得URLは保守的に拒否する。
  URLを安全化したと偽ってqueryを無言削除せず、Adapterで適切な公開出典/sourceIdを確認する。
- capturedAt不明は省略。指定した場合はsource取得後のoffset付き日時。選択日・migration実行日を取得日にしない。
- Snapshotとref/coordinate/sourceは未知キーを拒否する。写真・レビュー・営業時間・生レスポンス用のfieldはない。
  営業時間等の更新・鮮度は既存ExternalTravelInformation、将来のObservation/Impact側で扱う。

## 保存許諾と採用境界

`createPlaceSnapshot(input, retention)`は入力をspreadせず、許可したfieldを明示構築する。
Domainの形チェックは、Providerから保存権利を得た証明でもユーザー認可でもない。

`PlaceSnapshotRetention`は**Adapterが確認してApplicationから渡す一時的な評価**であり、別Place正本でも
Trip保存fieldでもない。provider、`permitted | temporary | unknown`、保存可能fieldを明示する。
nameとsourcesの保持許諾が必須。optional fieldは許可されなければ取り込まない。
manual経路は実際のユーザー入力にのみ使い、外部sources/ref付き入力をmanual指定しても拒否する。
入力の出所を偽装した文字列だけから元Providerを検出することはできないため、UI/LLMからretentionを受け取らない。

**ADR 0041は変更しない。現在のMapbox Search Box結果はtemporaryで、恒久保存のgrantを発行しない。**
Provider名だけで許諾を決める巨大なDomain規則表も作らない。別の保存許可済み入力を扱う場合は
Adapterがその入力・field・attributionを再確認する。今回、検索Adapterへ新しい許諾や保存経路は追加しない。
Wikipedia/宿/レストランも検索で取得できたという理由だけでpermittedにしない。

- 鉄道: #385が既に保持可能として扱うversioned timetableの駅名と許可リスト化済みEvidenceを利用。
  source取得時点をcapturedAtにし、駅名をmanualやProvider IDにしない。未知の住所/座標は追加しない。
  selection chronology、予定時刻、乗換計算、provenance、後日のretrievedAtを許すrevalidationは維持する。
- 宿: 既存`CandidateSelectionPort`の宿保存許諾に、Place単位のfield許諾を追加。
  task内のcandidate ID解決→OfferingとEvidence照合→Place変換→replace Proposal→明示確認の経路は同じ。
  同じProvider/IDのgrantだけ使い、写真/評価/価格等をコピーしない。住所・座標の許可がなければ欠落のまま。

## 単一legacy converter

`convertLegacyTripPlan`の第三引数に、任意の`placeRetentionByItemId`（Adapterで確認した許諾・出所・任意capture日時）を追加する。
旧2引数の呼出しは引き続き有効。旧rawを変更せず、戻り値の`requiresLegacyRetention: true`を維持する。

| 入力 | 変換結果 |
| --- | --- |
| manual、名前だけ/有効なtuple | 同じPlaceSnapshot。Providerの検証日時等を捏造しない |
| wikipedia/mapbox、出所と許諾確認済み | opaque IDと許可fieldを変換。旧placeIdなしはproviderのみのrefでidentity未解決 |
| Provider許諾不明/temporary/Provider不一致 | placeなし + `place-retention-unconfirmed`。名前を含むProvider値をV2へ漏らさない |
| 不正tuple/範囲外/NaN/Infinity | coordinateなし + `place-coordinate-invalid`。有効な名前等は保持可能な範囲で変換。原本を残し再確認 |
| ID/座標のfield保持許諾なし | 許可された名前・出所等のみ + `place-fields-not-retained`。取得済み値を黙って移行完了扱いしない |
| 未知provider/空ID/不正出所等 | placeなし + `place-invalid`。他itemの移行を妨げない |

#414時点では、観光Placeを戻り値`placeMappings: [{ itemId, place?, schedule }]`へ返す。
scheduleは#386が追加した同じItineraryScheduleであり、別Activity保存型ではない。
これは**同じconverter内の未完了field mappingの結果**であり、Trip内の候補配列でも独立Repository/保存形式でもない。
#410でこの変換処理を同じ入口内のActivity.placeへ接続した。placeがない/部分変換の場合はdeferredItemIdsと警告を残す。
詳細は[Activity導入記録](trip-activity.md)を参照する。event Evidenceも同じ保存出所validatorで検証する。
別converterを再実装したり、移行結果を第2のPlace正本として保存しない。
旧raw削除・取込完了扱い・V2 writer・dual-write・会話削除変更は一切有効化しない。

## 後続と検証

- #377: runtime地点matching/dedupのみ。本型へ保存する前の解決と保存許諾は別。
- #410/#400: Activity/宿全体のmigration完了と採用導線。今回の同じ型・converterを拡張。
- #386/#387/#403/#413: schedule、要求、複数目的地、一般移動のPlace利用。型を複製しない。
- #402/#408: Placeと時刻/外部事実を照合。座標/ref/source欠落を成立・安全とは扱わない。
- #388/#389: DTO/保存/認可/CAS/取込記録/保持許諾再確認とwriter gate。新しいDomainモデルは作らない。

テストは名前のみ、opaque identity、同名別ID/Provider、境界座標、不正座標、未知field、raw除外、
source/保存許諾/なりすまし拒否、legacy各providerと原本不変、鉄道の後日再検証、宿のfield限定採用を確認する。
Agent Contextの意味・prompt・Tool contractは変更しない。既存privacyと候補/計画/観測の分離を維持する。
