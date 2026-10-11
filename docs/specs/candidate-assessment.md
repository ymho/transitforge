# 取得済み事実による候補Assessment

## 正本と入力の信頼境界

- TravelCandidate = 比較対象。Assessmentが失敗/partialでも削除しない。
- TravelCandidateAssessment = candidateId / assessedAt付きのderived view。総合点・ランキングではない。
- Trip.request = 今回条件。Trip.items = 採用済み計画。評価のために仮TripやProposalを作らない。
- realtime facts = 現在の運行等。計画の正本を更新しない。

`CandidateAssessmentFacts`は永続モデルではなく、既存resolverが保持する**取得済みの読取引数**。
places/dates/groundAccess/weather/hazard/prices/partyは既存ExternalTravelInformationを使い、
railは既存VerifiedRailCandidateと取得済みRailTimetableInputを参照する。
解決済みPlaceとの関連付けは検索・Provider境界の責務で、モデルの自己申告ではない。
weatherのtarget.place、hazardのplaceは、その照会が対象としたresolved identityをApplicationが渡す。
名称文字列しか照会結果と結び付かない場合は、このbindingを作らずunknownにする。
既存の市名geocoding/警報feed検索だけでは正確な施設・地域包含関係を証明しない。

`assessTripCandidate`は候補ID、Trip/task所属、期限、item scopeを確認してDomainへ渡す。
Tool引数はcandidateIdと任意itemIdだけ。status、価格、Evidence、Provider JSONは受け付けない。
DomainではカテゴリごとにTool envelope、source種別・時系列・identity、数値範囲を検証する。
価格は候補の商品provider/opaque ID/観測額・日時・出典との一致を確認する。
問題があるカテゴリだけinvalid-facts/unknownにし、別カテゴリの有効情報は残す。
全体のcandidate/scope不一致はエラーにする。未知の出典IDや衝突するsource記録を根拠にしない。

信頼したresolverへ接続していないProviderの結果を採用済みと扱わない。
resolverが未取得カテゴリを返さなければunknownで評価できる。既存候補だけでも比較を止めない。

## hard / soft / relevance

effectiveTripConstraintsのhardとsoftを分け、unconfirmedな仮定はunknown、rejectedは対象外。
itemIdなしのitem-scoped条件は、どの予定の候補か推測せずpartial-coverageとする。
hard全体はviolated優先、次にunknown、全件確認できたときだけsatisfied。
条件ゼロはunknownであり「全旅程成立」としない。softのconflictでhard violationを作らない。

- origin / destinations: samePlaceIdentityだけ。多地点・fixed順序・再訪を維持する。
  names/summaryDestination/検索順位/Wien-Vienna等の文字列を同一性の根拠にしない。
  異なるProvider間の非一致だけでは別地域と断定せずunknown。同じauthorityの異なるIDは不一致として扱う。
  取得地点列がpartialなら、不在だけで不一致を確定しない。
- dates/duration: 出所のある候補の暦日範囲だけ。終端やtimeZoneが不明なら補完しない。
- depart_after/arrive_by: 同定済みendpointと検証済みscheduled instantが揃うときだけ比較する。
  現TrainIndexには安定駅IDがないため、名前だけのrail endpointはidentity未確認になる。
- mobility: 検証済み移動分数/乗換数/modeのみ。未取得の列車属性、車利用可否等はunknown。
- budget: 取得済み費用が対象candidate/scopeに完全、basis一致、同通貨の場合だけ比較。
  これは候補単体の費用比較で、Trip全体の成立性は#402。鉄道運賃未取得ならcompleteにしない。
- experience/pace/adventure/relative distance等、主観や不足事実はunknown。数値scoreを作らない。

relevanceはeffectiveなdestinations評価からfit/questionable/unknownを導出する。
要求identityと確認済み候補identityが異なる場合はquestionableとするが、自動で候補を除外しない。
#366の別地域回帰はY。#366の実モデル再探索や#377のsemantic matchingを完了扱いしない。

## mobilityと計画/realtimeの分離

`verifyRailCandidateSchedule`は既存のserviceDate/UID/trainNumber/stop index/digest・scheduled facts・
transfer rule/pace・verification時系列を照合する。採用処理もこの同じpure invariantを使う。
戻り値は選択前の計画事実でselectedAtを持たず、Assessmentへlegs配列自体もコピーしない。
計画分数は最初のscheduled departureと最後のscheduled arrivalのinstant差、乗換は検証済みtransfers数。
JourneyRouteResultのaggregate、delayMinutes/status/congestion/現在位置は参照・保存しない。
日跨ぎは既存service-day minutes→ZonedInstant変換のままで、moduloや逆算をしない。

GroundAccessRouteはProviderが返したdurationMinutesとwalk/car/bicycleを利用できる。
routeが1件でも乗換数0とはしない。transfer不明ならmobility=partial、route欠落ならunknown。
window/day/unscheduledから絶対時刻や所要時間を生成しない。

## weather / hazard / freshness

既存WeatherForecastのdailyを使い、対象place/date rangeと出典IDを保持する。
対象全日がなければforecast-range-out/unknown、API失敗はunavailable、不正値はunknown。
Provider自身のgeneratedAtは現契約にないため捏造しない。observedAtがあれば保持し、
retrievedAtとvalidUntilはsource別freshnessに保持する。assessedAtで観測日時を書換えない。

評価の気象条件は予報生成ではなく、明示した簡易比較指標:

- poor: いずれかの日で降水確率70%以上、降水量10mm以上、または雷雨code 95/96/99。
- favorable: 全日で確率30%未満、降水量1mm未満、WMO code 0〜3。
- mixed: それ以外の既知WMO code。未知codeはunknown。

暑熱・強風・歩行者個別の安全性まで「良好」と保証しない。好みとの最終trade-offはモデルが説明する。
hazardは[HazardAlert](trip-impacts.md)の情報ありならpresent、未取得・空feed・範囲の網羅性不明ならunknown。
現在の注意情報が未来の旅行日にも有効とは断定しない。公的severityを候補rejectやTripImpactへ直接変換しない。

鮮度はfresh/stale/unknown/unavailable。現在評価に使うweather/alert/価格/ground結果は有効期限を確認し、
古い値や鮮度不明を現在の良好情報として使わない。計画時刻表の検証と現在観測の鮮度は別。
既存weather/ground providerのrequest URLはqueryに位置/API keyを含み得るため、
安定sourceIdがあればURLを投影から省略する。queryを削った別URLを同じ証拠と偽装しない。
安全なsourceIdもなければunknown。Provider raw、長い本文、写真・review等はAssessmentへコピーしない。

## Money / party

PriceObservationを原通貨・observedAt・basisごと保持。候補の商品に対応し、出典が同じ観測を裏付けるものだけ使う。
同通貨の小計だけaddMoneyで計算し、異通貨はmixed-currency/non-comparable。
複数のOffering小計を採用済み旅程総額と呼ばない。coverageは信頼した取得境界の確認情報であり、
単に全Offeringにpriceがあることからcompleteを自動生成しない。未取得額は0ではなくunpricedItemCount。
金額overflow・出典不一致・古い観測はunknown。FXやReservationは追加しない。

TripPartyはProvider入力の大人/子ども年齢と明示的なsupportedの取得根拠が揃う場合だけ評価する。
未知の子年齢や未確認仮定、照会人数違いはunknown。Partyに新しいhard/soft fieldを作らず独立表示する。
Provider入力への対応可能性は空席/予約の証明ではない。

## Agent / UI / Evidence

`assess_travel_candidate`は任意の読み取りTool。Bedrockが追加検索・質問・候補比較を選ぶ。
評価からweather→hazard→route等を呼ばず、loadTimetablesも呼ばない。新Reflection/model callなし。
同一実行の成功済み同一Tool入力に関する既存の重複実行抑止は変更しない。
評価はassessedAt時点の取得済み事実。新しい事実が候補へ結合された後の実行では改めて評価できる。

Tool結果は`candidate: { id }`と`assessment`の対で次のConverse stepへ返す。
初期ContextにもApplicationが計算した同じ対（sources付きAssessment）をgetTravelCandidatesから渡せる。
既存Context builderが一度だけ投影し、sourceRef/制約ID/原通貨/unknownを保持する。
currentTrip、realtimeFactsは別field。件数/全Contextの既存圧縮budgetは維持する。
source本文・Provider rawは投影せず、許可された出典metadataだけがEvidence mapperへ渡る。

Agent Evidenceは既存のderived_value、EvidenceReference、validateEvidenceAndClaimsを再利用する。
入力のExternalSourceEvidenceとAgentの評価Evidenceは役割が異なり、別の永続Evidence型は作らない。
不存在Claim参照の拒否、既存Grounded E2E・Viewer policy・limitsを維持する。
**構造検証は自由文の全主張の意味的一致を保証しない。** #376に記載された最終自由文のClaim網羅性を
Assessmentだけで検証済み事実の不足を埋めない。新しいGroundingルールエンジンも作らない。

candidateAssessmentViewはpure helperで移動・天気・注意・hard未確認/不一致・原通貨観測を返す。
unknownはwarningの表示意味を持ち、「問題なし」や0円へ置換しない。全面DOM/#390を先取りしない。
