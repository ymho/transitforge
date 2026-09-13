# Tripの訪問予定地点と表示要約 (#403)

正本は[#382](https://github.com/ymho/transitforge/issues/382)、[#415](https://github.com/ymho/transitforge/issues/415)、
[ADR 0052](../decisions/0052-establish-trip-v2-contract-and-migration.md)、[Tripライフサイクル契約](trip-lifecycle.md)。
本書はPR #431を取り込んだmain `834e778`からの差分を記録する。V2には既にtop-level `destination`がなく、
今回はその削除ではない。新しいDestination aggregate、Repository、Place型は追加しない。

## 現状 → 今回の扱い

| 現状 | #403の変更 / 残す境界 |
| --- | --- |
| `Trip.request.constraints[].requirement`の`type=destinations` | `places`と`order`は希望。今回も採用や充足の証拠にしない |
| V2のTransport / Stay / Activityが個別にPlaceを持つ | `projectTripPlaces`で既存PlaceSnapshotの順序付き出現を取り出す |
| V2の短い表示用目的地がない | optional `summaryDestination`を同じTripに追加。国・都市・場所を推定しない |
| legacy `TripPlan.destination` | 同じ`convertLegacyTripPlan`でsummaryだけへ移す。Request/itemsは作らない |
| legacy `TravelPlan.destination`、TripPlan writer/UI | 検索結果・旧画面の互換契約として維持。V2への暗黙縮退や逆変換は追加しない |
| V2 Agent Contextに`destination: "未設定"` | 撤去し、summaryとitems由来の構造化地点を渡す。legacy Contextの互換fieldは残す |
| Agent Context圧縮 | 地点の識別子・順序・省略フラグを保持。先頭地点をTripの目的地へ昇格させない |
| UI | `tripPlacesPreview`のpure表示helperのみ。画面・writerの全面切替は#390/#388/#389 |

## 3つの意味

- **Request**: 利用者の希望、出所・hard/soft・仮定を含む。希望するだけでは訪問予定に含めない。
- **Trip.items**: 現在採用した計画事実。候補や検索結果・現在の運行状態は含めない。
- **summaryDestination**: 1〜200 UTF-16 code unitsの非空文字列。空白だけ・非文字列・長すぎる値は拒否する。
  表示/検索補助であり、items更新との自動同期、Place生成、成立性・hard constraint評価の根拠にはしない。
  Tripの未知field拒否、schemaVersion=2、revisionの既存契約を維持する。

今回はsummaryを会話から変更するTool/metadata Patchを追加しない。既存item/Request/状態Proposalで
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

## Context / Ask + Progress

`createAgentContextSnapshot`のV2投影は`summaryDestination?`、`itineraryPlaces`、
`placesTruncated`、`placeSemantics`と従来のitem別schedule/selectionを返す。
要求は既存`request`からモデル境界の`persistedTripRequest`へ別fieldで渡し、
`travelCandidates`/`realtimeFacts`も従来の別fieldを維持する。

地点はname/ref/areaのallowlist。写真・Provider raw・source本文・座標は追加しない。
Snapshot段階は各一覧24件、name/areaは100文字まで。256文字を超えるopaque refは
途中で切った別IDにせずrefごと省略する。いずれも`placesTruncated=true`を返す。
モデルContextでは各一覧20件、全体24,000文字の圧縮時は8件、次段階は4件へ縮める。
ここでも省略を明示し、残ったIDは正規化せず保持する。希望条件は従来どおり無言で捨てない。

Tool追加、旅行順序の固定Planner、発話regex、常時Reflectionは追加しない。
既存のknown-requirement policyが確認済みdestinationsの聞き直しを拒否することをRuntimeで試験し、
結果を受けたモデルの再計画でProposalを表示する。採用地しかない場合も構造化Contextで判断を支えるが、
実モデルが常に正しい質問を選ぶ保証ではない。

`tripPlacesPreview`はsummary（あれば）、訪問予定の矢印列、宿泊予定の列を表示できる。
単一都市・未採用にも対応し、地理階層・予約状態は補わない。全面UIは実装しない。

## legacy migration / writer gate

同じconverter入口で有効な`TripPlan.destination`をsummaryへコピーする。空・不正・長すぎる場合は
`summary-destination-invalid`警告（owner #403）を返し、省略する。最初の宿や移動先で穴埋めしない。
`requiresLegacyRetention: true`のまま元データを保全する。
item ID・順序・他都市・既存の部分変換/保存許諾/警告は維持し、入力を変更しない。
`TripContext.destinationWish`の別途migrationは#387のlegacy/未確認要求として維持する。
表示destinationをuser-confirmed requirementへ昇格させない。

V2→legacy Trip全体の逆projectionは現状なく、今回も追加しない。将来必要な場合も
summaryのみ表示互換に使用でき、なければpartial/unavailableとする。最初のstayやendpointを採用しない。
legacyの全stay選択導線は今回のV2 read projectionとは別で、#390のitem-ID UI移行へ残す。
LocalStorage writer、server保存、dual-write、会話削除、revision/CASは変更しない。

## 検証 / AC自己レビュー

| 要求 | 確認 |
| --- | --- |
| optional summary・invalid・未知field | `trip-places.test.ts`。単独summaryでもitemsは空のまま |
| 3都市以上、単一都市、再訪 | Vienna/Salzburg/Zürich、Tokyo/Hakodate/Sapporo、Viennaへの再訪を順序比較 |
| rail / non-rail / stay / activity | 全leg、unresolved/未選択/placeなしの除外、宿と活動地の違いを確認 |
| identity限定のunique | first-seen、別ID/provider、同名manualを試験。ordered一覧は別に保持 |
| Request / actual / summary | 要求のみはvisitedにならず、未実装destinations評価はunknownのまま |
| legacy | destinationだけ表示へ、他都市保持、空値警告、input不変、同入力同結果 |
| Context | V2 destinationなし、3分離、24→20→圧縮の省略フラグ、opaque ID保持 |
| Ask + Progress | 既知目的地の質問拒否→提案表示。TTFI/VisibleProgress、writer未呼出し |
| UI | summary/訪問/宿泊、単一都市/空計画のpure表示試験 |
| 非対象を維持 | #377検索、#402成立性、#388保存、#389CAS、#390全面UIは変更なし |

全test/build/architecture/workspace check、Smoke/Full Evalを実施する。
既存A〜Sを維持してT（希望3都市→2区間の仮Proposal）、U（複数採用地点→自由時間追加）を追加する。
これらはproduction Runtimeを通すscriptedモデル・synthetic Providerの契約評価で、実モデル品質の証明ではない。
Tのmode=other/unscheduledは未検討の手段・時刻を表し、国際移動の成立性を断定しない。

2026-09-13の`aws sts get-caller-identity`は`Your session has expired`となりLive Evalは未実施。
既存認証を更新した後の再実行:

```bash
npm run eval:agent:decision:live -- --suite trip-progress --profile full --case T-multi-city-request --output-dir /tmp/raiquora-403-live-t
npm run eval:agent:decision:live -- --suite trip-progress --profile full --case U-multi-city-trip --output-dir /tmp/raiquora-403-live-u
```
