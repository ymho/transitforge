# 宿泊候補と採用情報

検索候補、旅程への採用、予約記録を分離する。価格観測は[費用仕様](trip-costs.md)、予約記録は[予約仕様](trip-reservations.md)を参照する。

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
  observedPrice?: PriceObservation;
  observedDetails?: AccommodationObservedDetails;
}
```

`AccommodationOffering → selection → AccommodationSnapshot → booking → Reservation`を分ける。
商品はprovider/providerItemId、施設はplace.ref。opaque IDを名前や別Provider IDから合成しない。
同じ施設へ異なる商品を採用できる。matching/dedupは検索Adapterの責務で、採用処理は解決済みの対応を受け取る。

- `selected`は旅程へ採用した宿であり、予約済み・未予約・決済済み・空室確保のいずれも断定しない。
- 商品ID、selectedAt、両日付、非空sourcesは必須。日時不明のlegacyをこの型へ無理に昇格しない。
- checkIn < checkOut。共通item.scheduleのdate/endDate(exclusive)/既知zoneと一致しなければ拒否する。
- sourceはdurableなaccommodation/observed。provider/sourceIdが商品identityと一致し、retrievedAt <= selectedAt。
- observedAtがあればretrievedAt以前、validFrom/validUntilがあれば選択時点を含む。選択後の鮮度を保証する契約ではない。
- sourceの許容field/安全なcitation URLは既存Place source validationを再利用する。runtime IDだけでは証明しない。
- extra/raw/price/availability/bookingUrl/image/review/予約status/referenceをDomain exact-key validationで拒否する。
- titleは表示用の「宿泊」とし、候補変更で古い宿名を残さない。宿名の正本はsnapshot.place.name。

参考価格はoptionalなobservedPriceに原通貨と観測日時を保持する。予約状態/referenceは独立したReservationが所有する。Provider再検索や価格変更で採用Snapshotを無言更新しない。

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
保持可否は信頼済みAdapter/Applicationの責務であり、モデル/UIが任意のOfferingへ許可を付けることはできない。本番Rakutenでは施設番号・ホテル名・宿泊日・出所/取得時刻を旅程参照として保持する。外部サービス名は`provider=rakuten-travel`と`sources.attribution=楽天トラベル`で保持する。この最小参照の方針は、提供元のデータ全般の複製権を確認したという意味ではない。

[楽天トラベル施設検索API](https://webservice.rakuten.co.jp/documentation/simple-hotel-search)の`hotelNo`は施設番号であり、施設名`hotelName`との対応を実Adapterで確定する。施設番号を返すことが確認できたこのAPIだけに適用し、汎用の商品ID・legacyの`travel-provider`から施設IDを自動生成しない。Domainの汎用契約・独立resolverの経路も維持する。参考価格はtrusted Adapterの許諾と観測日時を検証して保存する。検索時の写真URL・評価・詳細URLは`observedDetails`として採用Snapshotへ保存する。画像バイナリ・説明文・空室・予約状態・rawは保存しない。

候補A→Bは同じitem IDのreplaceで、候補配列や旧Snapshotを書き換えない。
確認時は既存confirmCandidateSelectionで再解決し、selectedAtだけは確認時刻とする。
日付/施設/Evidence等が変わったら新しいpreviewが必要。expiry後は拒否する。
新しいCandidate Repositoryや別の永続正本は作っていない。

## 宿泊候補の比較画面

相談からの宿泊検索は通常最大10件を要求する。Providerが返した実候補だけを表示し、Evidence・公開カード・採用検証も10件まで保持する。実際の件数は検索条件とProviderの結果に依存する。検索結果の受信では旅程画面へ移動せず、相談画面で前後の矢印と件数表示から1件ずつ比較する。採用ボタンと宿の詳細・最新料金へのリンクを隣に配置する。宿泊カードに追加の詳細検索ボタンは表示しない。

## 検索時の宿情報と予約導線

Rakutenのtrusted Adapterは`displayRetention=permitted`を付与し、同じOfferingから公開画像URL・評価・レビュー件数・詳細URLを`observedDetails`へallowlistでコピーする。観測日時は保持証拠の取得日時とし、採用日時より未来を拒否する。参考価格は既存`observedPrice`を使う。画像はHTTPSのみ、リンクは認証情報・秘密値を含まないHTTP(S)だけを許可する。モデル/UIが保持許諾を指定する入口は追加しない。

旅程の宿詳細は写真・星評価・検索時の参考料金・外部予約リンクを表示する。共有閲覧でも同じ保存済みTripを使う。取得失敗した画像は非表示。旧Tripも読め、Rakutenの検証済み施設番号がある宿には施設詳細リンクを生成するが、旧データの写真・評価・価格は推測せず、再検索・採用した時点から保持する。日付変更後も観測情報は検索時点のままであり、現在価格・空室を断定しない。
