# 原通貨Moneyと価格観測 (#412)

#382/#415・ADR 0052の同じTrip/Offering/Requestを拡張する。PR #430をマージしたmainを基点とする。

## 棚卸しと実装境界

| 現行 | #412 | 残す境界 |
| --- | --- | --- |
| TravelPrice = amount + JPY | 唯一のMoney、PriceObservationへ置換 | 別の宿/体験Moneyは作らない |
| AccommodationOffering / ExperienceOffering | price?: PriceObservation | 空室・画像・予約導線は候補のみ |
| TravelExpenseSummaryの円合計 | totals: Money[]、通貨別小計 | 鉄道運賃除外、総費用保証なし |
| travel-provider.tsのminimumCharge円変換 | Provider境界で観測に変換、Domainは共通観測を検証コピー | Providerのraw値はTripに入れない |
| HTTP宿泊Provider | 安全な整数JPYと受信時点を観測として返す | 数値小数/unsafe値は料金欠落として扱う |
| HTTP wire / validator | 同じPriceObservationを検証 | frontend/backendは対で配布。旧wire価格はvalidとしない |
| legacy TripAccommodation.price | JPYのreader/writerを維持 | 外貨を円と偽装せず、旧旅程projectionでは外貨価格を省略 |
| #400 selected stay | optional observedPriceを追加 | 候補に値があるだけでは保存しない |
| #387 budget未実装 | budget limit: Money、basis: trip/per-person | 費用網羅性がないので評価はunknown、予算内認定しない |
| Agent / preview | 候補観測と採用時観測を分け、原通貨と日時を保持 | Runtime/Planner/質問順の変更なし |

既存restaurant budgetはProviderの説明文字列であり、数値Moneyへ推測parseしない。
railの運賃は依然取得/推定しない。非鉄道transportやActivityへの価格保存は本Issueで追加しない。

## Money / currency

正本は modules/trip/domain/money.ts。amountMinorは非負safe integer、currencyはCurrencyCode。
exact-key validationで旧amount、raw、未知fieldも拒否する。
対応範囲は **JPY、EUR、CHF、USD、GBP、KWDの6通貨**。全ISO通貨対応とは称さない。
SIX ISO 4217 List One（公開版2026-01-01）から確認したminor unitをコードで固定する。
JPY=0、EUR/CHF/USD/GBP=2、KWD=3。XXX（非通貨）、XTS（試験）、未対応通貨は拒否する。
正規表現だけでコードを認定せず、Object.hasOwnによる明示表を使う。

根拠: [SIX公式データ標準](https://www.six-group.com/en/products-services/financial-information/market-reference-data/data-standards.html)、
[List One XML](https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml)。
更新時は同XMLの公開版と対応code/minor unitを確認し、money.tsとテストを同じPRで変更する。
ランタイムでネットワーク取得やIntlからの桁推測を行わない。通貨廃止時も保存済み原額を無言変換しない。

addMoney/compareMoneyは同一通貨だけを処理し、異通貨は例外。加算結果のsafe integerも検証する。
formatMoneyは整数文字列の桁位置から小数点と区切りを作り、浮動小数へ割り戻さない。
原通貨のみで、FX Provider/自動換算/支払/税やサービス料の世界共通化は実装しない。
将来の換算は原額と別projectionにし、換算額・厳密なrate・source・観測時点が必要。

## Providerと観測

PriceObservation = { price: Money; observedAt: string; basis?: reference-minimum | selected-dates }。
observedAtは有効なoffset付きISO instant必須。basis不明は省略できる。
日程指定料金であっても総額・人数分・税サービス料込み・予約価格とは認定しない。
検索日の価格であり、同じ価格で現在購入できる保証ではない。

backend/agent-api/src/adapters/provider-money.tsのparseProviderMoneyはdecimal stringを厳密変換する。
指数、空白、符号、カンマ、leading zero、桁超過、負数、非stringを拒否し、BigIntによる10進組立後にsafe integerを検査する。
末尾小数桁の切捨て/丸めも行わない。APIがdecimal stringならこの境界を再利用できる。

既存宿泊APIのhotelMinChargeはJSON numberのJPY契約。整数0以上/MAX_SAFE_INTEGER以下だけ受け入れる。
floatのMath.round(value * 100)はしない。string料金も、このnumber専用endpointでは勝手に解釈しない。
観測日時はJSON応答を読み終えた受信時点（注入Clock）。Provider自身の更新時刻は不明であり捏造しない。
空室照会成功はその応答の観測時点、失敗fallbackは元の検索応答の観測時点を保持する。

TravelExpenseSummaryは渡されたOffering群の通貨別小計、pricedItemCount、hasUnpricedItems、
excludesRailFare=trueを返す。候補一覧を渡した小計を「採用旅程の総額」と呼ばない。
異通貨の総計fieldは存在しない。価格不明だけならtotals=[]であり0円ではない。

## 保持許諾とchronology

trusted AccommodationSelectionEvidenceにpriceRetention?: permitted/forbidden/unknownを追加する。
商品identity・日付・施設の許諾と価格の許諾は別。モデル/UIは引き続きIDだけを渡す。
その候補商品に対する価格保持許諾、validな観測、observedAt <= source.retrievedAt <= selectedAtが揃ったときだけ、
allowlistでobservedPriceを構築する。欠落/不明/不可/不正な価格は省略し、宿の採用自体は継続する。
実Providerの権利をこのPRで新たに許可したわけではない。fixtureだけが架空の許諾を持つ。

DomainもobservedPriceの構造・原通貨・日時と少なくとも1つの保持済み商品sourceのretrievedAtとの順序を検証する。
Evidenceは既存ExternalSourceEvidenceを再利用し、別の価格Evidence正本を作らない。
availability/booking/raw等は引き続き禁止。再検索でSnapshotを無言更新しない。

## migrationと表示

legacy-money.tsは整数JPYを同値のMoneyへ純粋変換できるが、PriceObservationへは昇格しない。
legacy価格のobservedAt/保持許諾は不明。同じconvertLegacyTripPlanの#400方針を維持し、
宿も価格もunselected + stay-snapshot-deferredで原本保全する。移行時刻を観測時刻へ流用しない。
逆方向のlegacyAccommodationPriceはbasis既知のJPYのみ。basis不明を参考最安と偽装しない。外貨候補は新Offering/Context/V2 previewでは保持し、
JPY専用の旧TripAccommodationへは価格を落とす。旧保存形式の拡張/dual-writeはしない。
旧地図カードの整数円表示は互換表示として残し、#390の全面移行で原通貨表示へ統合する。

currentTrip.schedule[].observedPriceはpriceSemantics=retained-selection-observation-not-current-priceと共に投影する。
travelCandidates[].priceやTool結果のpriceは候補観測として別領域に保つ。原通貨/amountMinor/observedAt/basisをflattenしない。
宿previewは「選択時の参考価格: EUR 120.00（観測: …）」を返す。価格なしでも宿名/日程を表示し、0円にしない。
追加のモデルcall、reflection、固定Tool routerはない。

## 検証・後続

Money/parse/集計の境界値、JS number Provider負例、HTTP validation、保持不可と不正日時、legacy pure変換、
Domain Snapshot、Runtime/DOM/Contextの原通貨保持をテストする。
従来A〜RにS（EUR宿の採用/価格観測/preview）を追加する。混在通貨はDomainのコード評価で検証する。
Sはscripted modelで本番Runtimeと同じvalidation/presentationを通す試験で、実モデル品質や実価格を証明しない。

V2 writer、server/dual-write、CAS、Reservation、全面UIは未変更（#388/#389/#398/#390）。
費用網羅性/予算適合性の完成は#402/#406、将来FXは別の明示scopeで扱う。
Liveは2026-09-13の既存AWS認証が期限切れのため未実施。再認証後のコマンド:

```sh
npm run eval:agent:decision:live -- --suite trip-progress --profile full --case S-eur-accommodation --output-dir /tmp/raiquora-412-live-s
```

### 実行結果

- npm test: 1,574件（frontend/shared 1,366、backend 208）成功。
- npm run build / architecture:check / workspace:check: 成功。
- Smoke: 保存済み12/12、Ask 2/2、Trip Progress 8/8。
- Full: 保存済み42/42、Ask 7/7、Trip Progress 19/19。
- Q/R/SはいずれもTTFI=1、model call=1、tool call=1、既知条件の聞き直し=0。
- Python 13件、bundle:check、lambda:check、git diff --checkを実施。
- 専用format/lint scriptは未定義。型検査・architecture check・差分検査を使用する。
- 実モデルのlatency/token/品質改善はLive未実施のため主張しない。コード上の追加model callはない。

### Acceptance Criteria自己レビュー

| 条件 | 確認 |
| --- | --- |
| EUR宿の保存と表示 | 許可済みEUR観測のadoption、Snapshot、DOM/Context、Sで検証 |
| 異通貨非加算 | JPY/EUR・EUR/CHF小計、異通貨add/compare拒否、総額fieldなし |
| 既存JPY | legacy reader/writer回帰、pure整数変換、日時非捏造、宿の自動selected化なし |
| 換算履歴 | FXを実装しない。原通貨保持、legacyへ外貨をJPY化しない |
| 精度 | minor integer・桁数表・BigInt decimal parse・合計overflow・正確な文字列format |
| 保存許諾と時系列 | 許諾なし/不正価格のみ省略、Domainへの不正Snapshotはreject |
| writer/責務 | server、dual-write、CAS、後続のReservation/全面UI未変更 |
