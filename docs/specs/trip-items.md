# Trip V2 Activity

## Domain契約とadd

`ActivityItineraryItem`は既存baseのid/title/scheduleと、type=activity、category、任意placeだけを持つ。
categoryはsightseeing / food / experience / event / shopping / relaxation / free-time / other。
Domainの表示分類であってProviderのcategory codeでもTool選択規則でもない。
empty title/ID、未知category/field、不正Place/scheduleを拒否する。

場所なし自由時間をそのまま保持する。「未定」というPlaceを生成しない。
fixed/window/day/unscheduledは#386の型とvalidationだけを使い、日付不明を今日、
午後を14時固定、終了不明を0分としない。予約成立や訪問済みを推測しない。
placeは#414のPlaceSnapshotのみ。Provider rawや候補配列を入れるfieldはない。

PlanAssumptionのitem参照は種別に対して検証する。Activityはschedule/placeのみ許可し、
selection参照は場所の有無や仮定の確認状態にかかわらず拒否する。
却下したplace仮定はplace未設定、schedule仮定はunscheduledの場合のみ保持できる。
stay/transportの既存selection仮定の意味は変更しない。

`TripPatch`へ`{type: add, item, afterId?}`を追加した。
省略は末尾、指定は存在するIDの直後。空文字/未知ID/自己参照/重複IDは拒否する。
同じ列の先行addを後続add/replaceが参照できる。ローカルの作業配列で全件と最終Tripを
検証してからcloneを返し、不正列では元Tripを変更しない。replaceは既存同種itemのみでupsertしない。
revision/updatedAtはそのまま。remove/move、CAS、mutationId、冪等性、writerは#389の責務である。

## Application採用境界

`usecases/trip-plan/propose-trip-activity.ts`を入口とする。

1. `proposeManualActivity`: 利用者の予定意図とscheduleからadd/replace Proposalを作る。
   外部Evidence/ref付きPlaceをmanualと偽装できない。モデル向けToolではPlace入力自体を公開しない。
2. `proposeActivitySelection`: opaqueな候補IDを`ActivitySelectionPort`で解決する。
   このPortは短命の検索結果と信頼した検証metadataを返すApplication境界で、Trip Repositoryではない。
3. ちょうど1件、同じcandidate/Trip/task、期限、Provider内identity、sourceId、取得日時、
   confidence=observed、Place出所binding、名称/日付とPlace各fieldの保持許諾を確認する。
   lookup失敗/曖昧/期限切れ/unknown permissionはProposalを返さない。
4. restaurantはfood、ExperienceOfferingはexperienceへ明示mappingする。ジャンル文字列のrouterはない。
   restaurantの日時指定なしはunscheduled。体験日は許諾済みstartDateをdayへ写し、
   明示scheduleが提供日と異なる場合は拒否する。体験IDは会場IDに流用しない。
   体験の会場Placeはresolverが別途解決したものを使い、会場/出所を検証できない候補は採用を保留する。
5. titleと許可済みPlaceを明示構築し、place.sourcesにdurable sourceId/Provider/取得日時を保持する。
   raw、current price、空席、review、画像、bookingUrlはコピーしない。価格Observationは#412、予約は#398。
6. add/replace + 既存planning patchを同じProposalとして検証する。既存draft/refinementの編集は
   refinement、それ以外はdraftの案となる。lifecycleを変えず、元Tripは不変。

`ResolvedActivityCandidate`はPortの一時的lookup metadataであり、Providerレスポンスの保存型ではない。
retention/source/Provider identityをモデル・UIから受け取らない。
Mapbox temporary結果へ新しい保持許諾を発行しない。他Providerも名前だけでpermittedにしない。
synthetic fixtureのgrantは実サービスの利用許諾を意味しない。
実Providerごとの保持許諾・解決済み会場を供給するAdapterがない場合、その候補のV2採用は未有効である。

## Trip V2 Transport導入

## detailとschedule

`transport-detail.ts`のdiscriminated union:

- unresolved: optional mode。詳細・地点の確証がない段階。
- selected rail: mode=rail + SelectedRailJourney。未検証manual railをselected化しない。
- selected non-rail: mode + origin/destination PlaceSnapshot + provenance。
  provenanceはmanual、またはprovider/providerItemId/selectedAt/sourcesを持つprovider。

selectedは採用した**計画**であり、予約や運航・経路成立の証明ではない。
manualはホテル→空港のタクシー、駅→美術館の徒歩、レンタカー、便未定のフェリー/航空を
名前だけのPlaceSnapshotとともに表せる。Provider未接続でもotherへ潰さない。

時刻はtop-level item.scheduleだけ。fixed/window/day/unscheduledの意味・IANA/offset/日跨ぎ検証は#386を使う。
detail内に発着・所要時間を重複保存しない。railだけは既存scheduled factsとfixed projectionを照合する。
未知field・不正mode・欠落/不正Place・不正scheduleを同じTrip validationで拒否する。

将来carrier/flight number等を導入する場合は該当modeのvariantを拡張する。
全modeに巨大optional interfaceを追加せず、現段階で運賃・便番号・空港identityを捏造しない。

## Application / Provider境界

`proposeManualTransport`はtitle/mode/両端名称/scheduleだけを受け取り、name-only manual Placeを構築する。
Provider identity、Evidence、storage permission、rawをmodel-facing inputとして許可しない。
各予定の自由入力はoptional `memo`（最大4000文字のプレーンテキスト）。`item_memo`は日時・選択・予約・確定状態を変えず、AIの`set-memo`提案も既存採用境界を通す。

`proposeTransportSelection`はcandidate IDをTransportSelectionPortで解決する。
resolverのrecordはAdapterが同定した短命の計画事実と許諾metadataであり、永続モデルではない。

1. ちょうど1件、candidate ID/Trip/task/期限・採用時刻を確認する。
2. Provider identityとdurable sourceId、timetable/web種別、confidence、取得時刻、有効期間を照合する。
3. identity/source/title/scheduleの保持許諾、および両端Placeのfield単位保持許諾を確認する。
4. 許諾済みPlaceとdurable sourceを既存allowlist関数で構築する。未知raw fieldはコピーしない。
5. exact-key検証済みscheduleだけを採用する。モデルによる候補日程の上書き入力は受け取らない。
6. 既存add/replace + planning patchを共通`proposeItineraryItem`で原子的に検証してpreviewを返す。

Candidate Bへの変更は既存item IDのreplace。候補未採用/曖昧/失敗時はTrip不変。
現在価格・availability・seat inventory・booking URL・delay/status・位置・rawは保存しない。
sourcesは既存ExternalSourceEvidenceを再利用し、runtime Evidence ID単独では証拠としない。
地点Providerと交通Providerは異なってよく、各Placeは自身のProvider/許諾と観測確度・取得/有効期間で検証する。
適切なendpoint解決と実Providerの保持許諾を供給するAdapterが未接続なら、その採用Toolは公開しない。
synthetic fixtureの許諾は実サービスの利用許諾を意味しない。Flight/Ferry/Bus APIは新設していない。

## mobility evaluator

- modes/excludedModes: scope内のselected移動それぞれのmodeで判定する。
- requiredModes: scope内のselected移動集合で各required modeの存在を確認する。
  例: rail＋rental-carの旅で両方requiredは成立。未解決移動で不足modeが確定できなければunknown。
- maxTravelMinutes: 各移動のfixed start/endのinstant差。往復合計ではない。window/day/unscheduled/終了欠落はunknown。
- maxTransfers: railの明示transfersのみ。manual bus/ferry等を1itemだから0回とはしない。
- rail固有の番号/UID/transferPace等: 非鉄道ではunknown。非該当を「条件充足」として数えず、
  必須列車が全旅行のどこかで存在するかという複合成立性は#402へ残す。
- arrive_by/depart_after: rail scheduled endpointまたはnon-rail fixed endpointを、既存Place identityで照合する。
  name-only同名だけでは証明しない。時刻・identityが不足すればunknown。既知の同地点への到着があっても、後続の未同定endpointを無視して達成としない。

unconfirmedなhard条件や未知事実をsuccessへ変換しない。ready認定・全旅程成立性は#402のまま。

## PlanAssumption

同じschedule/place/selection参照を維持する。
transportのplaceは**移動の両端の計画地点**、selectionは**採用した移動計画**を指し、予約・便確定とは別。
非鉄道selectedには両端必須のため、却下したplace/selection仮定を残すには同じProposalで
detailをunresolvedへ戻すか、元仮定との参照を適切に整理した別計画へ変更する。
schedule仮定の却下は既存どおりunscheduled化する。新しいAssumption型/DSLは作らない。
Activityにselectionを認めない#427レビュー修正、TripPartyの原子的却下は維持する。
