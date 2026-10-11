# 原通貨Moneyと価格観測

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

旧decimal string用Adapterは未接続のため#799で撤去した。将来decimal stringのProviderを追加する場合は、指数・丸め・桁超過等を拒否する専用境界を実際のProviderへ接続して設ける。Moneyの整数契約と検証は共有Domainに維持する。

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
楽天のtrusted Adapterは施設検索の参考最安料金を保持対象とする。その他のProviderは明示的な許諾なしに保持しない。予定ごとの表示・手入力は[概算費用](trip-costs.md)を参照。

DomainもobservedPriceの構造・原通貨・日時と少なくとも1つの保持済み商品sourceのretrievedAtとの順序を検証する。
Evidenceは既存ExternalSourceEvidenceを再利用し、別の価格Evidence正本を作らない。
availability/booking/raw等は引き続き禁止。再検索でSnapshotを無言更新しない。

## 予定ごとの概算費用

## 表示と入力

費用は旅程タイムラインの各予定に「概算費用」として表示する。旅行全体のAI概算生成、集計パネル、履歴のAI費用確認ボタンは撤去する。鉄道の予定には費用欄を表示しない。

楽天トラベルで採用した宿は `hotelMinCharge` の参考価格を表示する。これは1室1泊の最安料金の目安であり「〜 / 1室1泊」を添える。人数や泊数を掛けた旅行総額を自動生成しない。取得時刻・原通貨・価格条件を `AccommodationSnapshot.observedPrice` に保持する。価格のない既存宿に金額を補完しない。再検索・採用時に取得する。

他の予定はユーザーが予定全体の概算金額を入力する。宿にも手入力でき、入力額は参考価格より優先する。入力を削除すると宿は参考価格に戻り、それ以外は未入力となる。0円は未入力と区別する。説明の長い注意書きは表示しない。

## 保存契約

既存の `Trip.costs.lines` と `cost_lines` patchを使う。`forecast` は省略可能とし、初回入力時にAI forecastを要求しない。旧forecastとカテゴリoverrideは読み取り互換を保持するが、予定へ配分せず画面にも表示しない。Server Agentへ `propose_trip_costs` を登録しない。

手入力のCostLineは `item-estimate:` のID、単一 `targetRefs.itemIds`、`user_override`、`amountRole: total` を持つ。原通貨のsafe integer最小単位を保存する。存在しない予定と鉄道を対象にできず、予定削除時には当該明細を除去する。ほかの予定の明細は保持する。費用は予約済み・支払済み・成立性の事実にはしない。

入力欄の保存から既存Server writer / CAS / read-backで直接反映する。同じ旅程の再取得では入力途中のフォームを保持するが、revisionが変われば古い変更案を保存できない。別会話・アカウントへ入力を持ち越さない。アプリ内の画面移動では未保存入力の破棄を共通dialogで確認する。タブを閉じる際のBrowser標準警告は表示しない。

## 検証

Domainで初回保存、0円、削除、複数予定、旧forecast互換、無効参照を確認する。UIで入力・確認・再取得・入力解除、古いrevisionと会話の拒否、鉄道欄の非表示を確認する。楽天の検証済み選択フローで参考価格の保存を確認する。実予約API、AI推定、通貨換算は使用しない。
