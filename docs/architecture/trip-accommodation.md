# 宿泊Offeringと採用Snapshot (#400)

#382/#415・ADR 0052を正本とする。PR #429の#413までの契約を再利用し、#400だけを実装する。

以下は#400時点の導入記録。#412で同じSnapshotへoptional observedPriceと明示的な価格保持許諾を追加した。
現在の価格契約・Context・previewは[Money導入記録](trip-money.md)を参照する。他のvolatile値とwriter gateは維持する。

## 現行棚卸しと変更

| 対象 | 現状 → #400 |
| --- | --- |
| travel-candidate.ts / AccommodationOffering | Provider検索・比較のvolatile候補。price/availability/bookingUrl/image/reviewを保持してよいがTrip正本にしない。検索Adapter・候補表示は変更しない |
| travel-plan.ts / TripAccommodation | legacy検索応答・reader/writer・地図選択UI用の重複slice。互換性のため残し、新規V2コードから利用しないと明示 |
| trip.ts / StayItineraryItem | inline accommodationを同じAccommodationSnapshotへ統合。別Stay aggregate/Repositoryを作らない |
| select-trip-candidate.ts | candidate/task/Trip/expiry・一意なOfferingを解決する既存入口を維持。宿の変換をselect-accommodation.tsへ抽出 |
| PlaceSnapshot | 商品IDから施設IDを自動生成していた処理を廃止。trusted resolverの独立した施設Placeを既存allowlistで保存 |
| ItinerarySchedule | checkIn/checkOut/既知のplace.timeZoneから同じday spanを投影。時刻正本を追加しない |
| TripParty | request.partyを保持し、人数や年齢、仮定を変更しない。Provider検索人数変換は既存#411 |
| Agent Context / preview | selected宿名・エリア・共通scheduleを投影し、両宿泊日を表示。legacy価格等をpersisted factとして送らない |

## 唯一の採用契約

```ts
interface AccommodationSnapshot {
  provider: string;
  providerItemId: string;
  place: PlaceSnapshot;
  selectedAt: string;
  checkInDate: LocalDate;
  checkOutDate: LocalDate;
  sources: readonly ExternalSourceEvidence[];
}
```

`AccommodationOffering → selection → AccommodationSnapshot → booking → Reservation`を分ける。
商品はprovider/providerItemId、施設はplace.ref。opaque IDを名前や別Provider IDから合成しない。
同じ施設へ異なる商品を採用できる。matching/dedupは検索Adapter/#377で、ここでは解決済みの対応を受け取る。

- `selected`は旅程へ採用した宿であり、予約済み・未予約・決済済み・空室確保のいずれも断定しない。
- 商品ID、selectedAt、両日付、非空sourcesは必須。日時不明のlegacyをこの型へ無理に昇格しない。
- checkIn < checkOut。共通item.scheduleのdate/endDate(exclusive)/既知zoneと一致しなければ拒否する。
- sourceはdurableなaccommodation/observed。provider/sourceIdが商品identityと一致し、retrievedAt <= selectedAt。
- observedAtがあればretrievedAt以前、validFrom/validUntilがあれば選択時点を含む。選択後の鮮度を保証する契約ではない。
- sourceの許容field/安全なcitation URLは既存Place source validationを再利用する。runtime IDだけでは証明しない。
- extra/raw/price/availability/bookingUrl/image/review/予約status/referenceをDomain exact-key validationで拒否する。
- titleは表示用の「宿泊」とし、候補変更で古い宿名を残さない。宿名の正本はsnapshot.place.name。

Money/TravelPriceやJPY固定値は追加しない。#412が必要に応じ同じSnapshotへ価格観測を拡張する。
予約状態/reference、booking操作は#398。Provider再検索や価格変更で採用Snapshotを無言更新しない。

## 信頼するadoption境界

モデル/UI入力はcandidateId/itemId/opaque宿selectorのみ。task IDはApplicationが注入する。
入口でunknown inputを拒否し、Offering/Evidence/保持許諾の自己申告を受け取らない。

1. 既存CandidateSelectionPortから候補IDを解決し、候補ID/Trip/task/expiry/採用時刻を検証する。
2. 商品provider/providerItemIdに一致するOfferingがちょうど1件であることを確認する。
3. 短命なAccommodationSelectionEvidenceで商品identity・日付・durable出所の保持許諾を確認する。
4. trusted resolverが別途解決した施設PlaceとPlaceSnapshotRetentionを確認する。refに施設IDがあればその出所IDも一致させる。
5. 同じcreatePlaceSnapshotで許諾fieldだけ保存し、施設の出所/確度/採用時点を検証する。
6. Offeringの日付と商品identity、retainable Place、コピー許可したsource、selectedAtのみを明示構築する。
7. 同じTripUpdateProposalへstable item IDのreplaceを載せ、Domain検証後にpreviewする。

施設Providerと宿泊商品Providerは異なってよい。宿泊プラン名を施設名へ上書きしない。
sourceとPlaceのraw extraはallowlist変換で捨て、出力SnapshotへのextraはDomainで拒否する。
保持可否は実Adapterの責務であり、Offeringを取得した/利用者が選んだだけでは許諾を得ない。
実サービスの権利が未確認ならstorageAllowedをtrueにせず、V2採用を拒否する。fixtureは架空の許諾である。

候補A→Bは同じitem IDのreplaceで、候補配列や旧Snapshotを書き換えない。
確認時は既存confirmCandidateSelectionで再解決し、selectedAtだけは確認時刻とする。
日付/施設/Evidence等が変わったら新しいpreviewが必要。expiry後は拒否する。
新しいCandidate Repositoryや別の永続正本は作っていない。

## legacy migration

同じconvertLegacyTripPlanだけを拡張する。

- legacy accommodationがあってもselectedAt・captured Evidence・保持許諾が不足するためunselectedを維持する。
- optionsをTripへコピーしない。宿名/住所/座標/価格/画像/Provider IDをmanualへ付け替えない。
- legacy stay.destinationは従来の予定目的地としてname-onlyの未選択Placeに保持する。Offeringからの施設名ではない。
- 宿泊日付は既存projectStayScheduleを使う。不正日付はunscheduled＋#386 warningで自動補正しない。
- stay-snapshot-deferred warningとdeferredItemIds、requiresLegacyRetention=trueを返し、元入力・順序・ID・決定性を保つ。
- 復元不能な宿の採用事実は再選択/証拠確認が必要。migration時刻をProvider観測/採用日時にしない。

V2 writer切替、server Repository、dual-write、会話削除変更、revision/CASはない。

## Agent / Ask + Progress / metrics

currentTripはselectionStatus/placeName/area/scheduleを投影する。商品価格・空室・review・画像・booking URLは送らない。
候補集合は別Contextであり、Snapshotの正本ではない。Trip.request.partyや既知条件はそのまま保持する。
既存propose_candidate_selectionの説明を宿のadoption/preview/予約境界へ具体化した。固定router/質問順は追加しない。

pure accommodationPreviewは施設名、保持可能なエリア/住所、check-in/out、ニュートラルな「採用した宿泊先」を返す。
同じ応答に質問を併記できる。全面UI・旧writerへの反映ボタンは追加しない。
既存terminal Toolの応答経路も維持するため、モデルの追加呼出は必須ではない。

表示されたselected stay add/replaceは既存itinerary progress/TTFIに入る。
内部Tool成功だけでは測らず、delivered=falseやpreviewなしの応答はTTFIにならない。
stayのselection/place/schedule仮定を却下したときは、既存整合性に従い同じProposalでunselected/unscheduledへ戻せる。

## Acceptance Criteriaと検証

| 条件 | 検証 |
| --- | --- |
| Offering/Trip/Reservation分離、selected宿1件 | Domain型、adoption A→B・他item不変 |
| 商品identityと施設identity | 異なるProvider/IDのfixture、出所不一致negative |
| volatile/raw/予約非保存 | Domain field別reject、Application入力・allowlist・Context・preview negative |
| schedule projection | 両日必須、timezone、invalid date/mismatch、既存rail回帰 |
| trusted adoption | candidate/Trip/task/expiry/一意性/Provider/source/chronology/保持許諾negative |
| legacy保全 | accommodationあり/なし、options、目的地mapping、manual偽装なし、pure/deterministic |
| Ask + Progress / TTFI | Runtime＋DOM、同turn質問、非表示・内部成功のみ負例、既存A〜Pと新Q/R |
| 仮定とwriter gate | selection/place/schedule却下、既存Activity/Party・原子的Proposal回帰、writer未呼出 |

`npm test`（1,503件）、build、architecture/workspace check、Smoke、Fullすべて成功。
Smokeは保存済み12＋Ask 2＋Trip Progress 7、Fullは保存済み42＋Ask 7＋Trip Progress 18。
Q/Rはscripted Runtime評価であり、実モデル品質や実サービスの空室を証明しない。

Liveは2026-09-13の`aws sts get-caller-identity`が`Your session has expired`で失敗し未実施。
認証方式は変更しない。更新後に次を実行する。

```sh
npm run eval:agent:decision:live -- --suite trip-progress --profile full --case Q-accommodation --output-dir /tmp/raiquora-400-live-q
npm run eval:agent:decision:live -- --suite trip-progress --profile full --case R-accommodation-change --output-dir /tmp/raiquora-400-live-r
```

後続はMoney #412、Reservation #398、全面UI #390、server #388、CAS #389。Provider cache全面構築は対象外。
