# Tripの訪問予定地点と表示要約

## 3つの意味

- **Request**: 利用者の希望、出所・hard/soft・仮定を含む。希望するだけでは訪問予定に含めない。
- **Trip.items**: 現在採用した計画事実。候補や検索結果・現在の運行状態は含めない。
- **summaryDestination**: 1〜200 UTF-16 code unitsの非空文字列。空白だけ・非文字列・長すぎる値は拒否する。
  表示/検索補助であり、items更新との自動同期、Place生成、成立性・hard constraint評価の根拠にはしない。
  Tripの未知field拒否、schemaVersion=2/3、revisionの既存契約を維持する。

summaryを会話から変更する専用Tool/metadata Patchはない。既存item/Request/状態Proposalで
summaryを失わないよう明示的に保持するだけで、無言の地理推論や更新をしない。

## 地点projection

`modules/trip/domain/trip-places.ts`は、validate済みのTripから次のderived viewを返す。
結果は入力と参照を共有せず、同じ入力に対して決定的である。

| field | 収録対象 |
| --- | --- |
| `visitedPlaces` | selected transportの全legのorigin/destination、selected stayのaccommodation.place、placeのあるactivity |
| `overnightPlaces` | selected stayのaccommodation.placeだけ。予約済みや宿泊実績という意味ではない |
| `transportEndpoints` | selected railのlegごと、selected non-railのdetail両端ごとに1組 |

各出現は`itemId`、役割、既存`PlaceSnapshot`を保持し、railは`legIndex`を含む。
unresolved transport、placeがあってもunselected stay、placeなしactivityは含めない。
TravelCandidate、Offering、Request、summaryはprojectionの入力に使わない。
`visited`は「採用計画上の訪問予定」であり、実際に訪問した証拠ではない。

items順、rail内はlegs順・各legのorigin→destination順を維持する。
`Vienna → Salzburg → Vienna`の再訪も、接続点の`A → B → B → C`も省かない。
地点の単純Set、名称による連続重複除去、address/areaからの都市推定は行わない。

`uniqueTripPlaces`は必要なUI向けの別helperで、#414の`samePlaceIdentity`だけでfirst-seen順に整理する。
同名manual、別provider、別ID、文字列だけのWien/Viennaを同一と判定しない。
表示名が違っても同一resolved identityなら整理できるが、元のordered projectionは変更しない。
matching/dedupの改善やgeocodingは#377の責務である。

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
Adapterがその入力・field・attributionを再確認する。
Wikipedia/宿/レストランも検索で取得できたという理由だけでpermittedにしない。

- 鉄道: #385が既に保持可能として扱うversioned timetableの駅名と許可リスト化済みEvidenceを利用。
  source取得時点をcapturedAtにし、駅名をmanualやProvider IDにしない。未知の住所/座標は追加しない。
  selection chronology、予定時刻、乗換計算、provenance、後日のretrievedAtを許すrevalidationは維持する。
- 宿: 既存`CandidateSelectionPort`の宿保存許諾に、Place単位のfield許諾を追加。
  task内のcandidate ID解決→OfferingとEvidence照合→Place変換→replace Proposal→明示確認の経路は同じ。
  同じProvider/IDのgrantだけ使い、PlaceSnapshotに写真/評価/価格を追加しない。宿泊商品の参考価格・表示観測は別の[AccommodationSnapshot](trip-accommodation.md)が所有する。住所・座標の許可がなければ欠落のまま。

## Place entity identityと検索対象binding

## 境界

永続的なPlaceRef / PlaceSnapshotは変更しない。Provider IDはそのentity自身のidentityであり、
「利用者が探す地区/施設そのもの」「希望地域に適合する」ことの証明ではない。
検索中のPlaceMedia.targetBindingはrequested targetへの照合結果だけを表す。
名前の部分一致、座標の近さ、検索順位からresolvedへ昇格しない。

- discovery: 周辺店舗などを候補自身として表示可能。targetBindingなしは「地域適合確認済み」ではない。
- target: 既に取得したtargetPlaceIdとprovider namespace、または取得済み本文とProviderの公式施設ページのexact bindingを要求する。
- source binding: 同一HTTPS origin/pathの施設ページのみ。host/root、query/fragment付きURLは証明にせず、複数entityが同じページへ一致する場合も未解決。
- unresolved/mismatch: 観測をTool結果に残すが、targetの地図候補へ入れない。discovery指定で既知の失敗bindingを消すこともできない。
- same-provider exact IDだけdedupする。親子別ID、異なるproviderは統合しない。

## 検索・表示の実装境界

| 経路 | 境界 |
| --- | --- |
| search_place_media | discovery / targetを明示。既知ID・読了URLはApplication stateから解決。候補ごとの既存Assessment relevanceと失敗bindingをTool observationへ返す |
| resolve_place_candidates | ページ本文の施設名は検索hintのみ。候補と結果の結合は一意な公式施設ページbinding。名前一致を同一性の根拠にしない |
| enrichment | 同一provider/entity、または一意な公式source bindingだけ写真/説明を補完。名前・近接座標で他entityの写真を添付しない |
| restaurant | Hot Pepper自身の候補・座標はそのまま表示。既知mapboxPlaceIdがある場合だけMapbox結果と結合。名前しかない飲食店へ追加POI検索しない |
| Activity / Trip adoption | 既存ActivitySelectionPortの単一ID解決、scope、期限、source、保存権限、allowlist snapshotを維持。target bindingが未解決/不一致ならProposalへ採用しない。discovery entityの明示選択は可能 |
| map layer / map candidate | 失敗bindingは描画候補にしない。表示name/位置はentity自身の値。detailは同じprovider ID以外をmergeしない |
| detail refetch | UIの取得済みrefをHTTPで渡し、Backendが再検索結果と照合。先頭の近隣店舗を代用しない。Mapbox landmarkはmapbox_idのみをopaque IDとして使い、feature描画IDを代用しない |
| Wikipedia fallback | Provider namespaceをidentity sourceとして明示。Mapboxと同名でもmergeしない |
| Agent / Assessment | 下記の既存relevanceをTool結果へ流し、モデルが次の確認・比較・説明を判断。検索語の自動書換えや固定再検索フローは追加しない |

## Assessment seam

targetBinding → 既存TravelCandidateAssessment.relevance → candidateAssessments / targetObservations
→ production executeViewerToolAdapter → bounded Tool observation → モデルの候補比較、という経路を使う。
照合結果を受けたモデルが推薦・追加確認を選び、Applicationは先頭候補を自動推薦しない。

Tripがある場合は既存assessCandidateConstraintsへTrip.requestを渡す。同じ名前や地域らしい文字列からfitへせず、
同じPlaceRefの目的地条件だけを確認する。一施設は目的地全体のcomplete coverageとは扱わない。
未構造化の地域希望を自然言語regexで正本化しない。検索所在地・未解決relevanceを見たBedrockが再検索/別確認/説明/質問を選ぶ。
保存済みcandidateのfull AssessmentでもplaceTargetBindingが未解決ならunknown、不一致ならquestionableへ反映する。
参照可能Evidenceがない場合はunknownを維持する。

## 保守的な制約

公式施設ページやknown IDがない正当な候補も未解決になり得る。legacyのprovider namespace不明データから同一性は推測しない。
mapbox_idを持たないlandmarkは名前と既存の相談操作を維持するが、別施設を詳細として埋めない。
同一性の不明な写真を補完しない。自由文のすべての事実を保証する契約ではない。
