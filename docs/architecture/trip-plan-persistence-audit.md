# Legacy TripPlanのprovider復元と契約棚卸し (#404)

2026-09-12、main `31a6517`のTripPlanとLocalStorage readerを基準に確認した。
親方針は [#382](https://github.com/ymho/transitforge/issues/382) と
[#415](https://github.com/ymho/transitforge/issues/415)。本修正はlegacy readerに限定する。

## 原因と修正

`SightseeingPlanItem.place.provider`はmanual/mapbox/wikipediaを許可していたが、
repositoryの`isTripPlanItem`はmanual/mapboxしか受け入れず、wikipediaを含むplan/store全体を
復元できなかった。別会話への保存時にも既存storeを読み直すため、既存planが落ちるおそれがあった。

`modules/trip/domain/trip-plan.ts`の同じ定数から`SightseeingPlaceProvider`型と
`isSightseeingPlaceProvider`を定義し、repositoryがこのpure helperを利用する。
未知値はrejectし、大文字変換やmanualへのfallbackを行わない。
保存キー・plan version 1・store version 2・既存の単一plan readerは変更しない。
V2型・converter・server migration・Patch適用の変更は含めない。

## Enum / unionの軽量棚卸し

| field | Domain / reader | 結果 |
| --- | --- | --- |
| item.type | movement / stay / sightseeing | 一致 |
| movement.mode | rail / rental-car / car / bus / walk / other | 一致。mode省略は既存legacy rail互換処理 |
| sightseeing.place.provider | manual / mapbox / wikipedia | 本修正で同一sourceに統一 |
| accommodation.availability | available / unknown（任意） | 一致 |
| accommodation.price.currency / basis | JPY / reference-minimum・selected-dates | 一致 |
| accommodation.provider | 任意string | enumではない。sightseeingのallowlistは適用しない |
| plan.version / store.version | 1 / 2 | 別の世代番号として一致。Trip V2ではない |
| TripJourneyPlanのtransferPace / rankingPreference、journeys内のdelayStatus等 | Domainに限定値があるがreaderは入れ子を検証していない | 下記の別課題候補 |

別課題候補: legacy `isJourneyPlan`は駅名とjourneysが配列かだけを主に確認し、
未知のtransferPace/rankingPreferenceや不正なjourney/legを通し得る。
旧データを新たにrejectする変更は互換性の判断が必要なため#404では実装しない。
旧readerの深いvalidationと原本保全を別Issueとして検討し、#385の計画専用Snapshot変換とは分ける。
型のstring/numberに対する文字数・人数等の制約もreaderにあるが、今回その上限は変更しない。

## 確認

provider全3種の保存→新しいstorageインスタンスでの復元を、移動・宿泊・観光・条件を含むplan全体の
等値比較で確認する。別会話を保存しても既存planを保つこと、未知providerの拒否と読込時の原本不変、
既存の単一plan形式からwikipediaを読み出せることもテストする。
provider別fixtureはDomain型をkeyとするRecordで網羅し、許容値追加時のテスト追加漏れを型検査で検出する。

#385には候補と採用済み旅程の分離・Trip骨格・SelectedRailJourney・単一legacy→V2変換を残す。
#405のreplace/upsertも変更しない。#415の最終契約は変更しない。
