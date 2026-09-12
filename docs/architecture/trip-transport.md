# Trip V2 Transport導入 (#413)

親方針#382/#415、ADR 0052に従い、PR #428をマージした`972864c`を基点とする。
Issue #413に残る「JourneyRouteResultを保持」は#415/今回の指示で置換し、SelectedRailJourneyを維持した。
本番writerは切り替えない。

## 棚卸しと正本

| 現行 | 今回 / 後続 |
| --- | --- |
| legacy MovementMode/ManualMovementPlanItem | rail/rental-car/car/bus/walk/otherのreader/writer/UIを維持。V2型には依存させない |
| Trip.transport.detail | 同じTransportItineraryItemのdetailを一般化する。別Tripモデルは作らない |
| SelectedRailJourney | scheduled facts、出所、乗換検証、後日の再検証をそのまま維持 |
| TripRequirement.mobility | legacy MovementMode依存を除き同じTransportModeへ置換 |
| Activity候補採用 | 既存add/replace・planning Proposal組立を共通pure helperへ抽出。新Repository/汎用Offering階層は作らない |
| Journey/TravelCandidate | railの比較・探索機能は維持。非鉄道Resolverは短命の検証recordでありTripへ候補配列を保存しない |
| Agent / VisibleProgress | 同じregistry、Context、preview、表示観測に非鉄道を接続する |

TransportModeはrail / air / bus / ferry / car / rental-car / taxi / ride-hail / walk / bicycle / other。
legacyとの対応は単一converter内で行い、otherをair/ferry等へ推測しない。

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
optional noteは今回追加せず、legacy noteもtitleへ連結しない。

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

## 単一legacy migration

既存convertLegacyTripPlanだけを拡張する。

- railは従来どおりunresolved。先頭journeyやdelayから採用計画を作らない。
- legacy bus/car/rental-car/walk/otherは有効な両端名称をmanual Placeとして保持し、同modeのselected予定へ移す。
- dateは既存mappingでday、不正ならunscheduled＋warning。移行日を予定日にしない。
- noteは正式な保存fieldを追加せずwarning/deferredと原本保持にする。titleへ連結しない。
- 不正mode/欠落名称はunresolved＋warning/deferred。未知追加fieldも原本保持して無言で保存しない。
- 入力不変、決定性、安定item ID/配列順、requiresLegacyRetentionを維持する。

## Agent / preview / TTFI

propose_manual_transportはV2 Tripがある場合、propose_transport_selectionは信頼したresolverもある場合に公開する。
phase/modeからToolを固定選択しない。モデルが意図・Tool・質問を選び、コードは入力・計画・許諾を検証する。
同じ実行中の先行Proposalを後続Toolが参照でき、既存Ask + Progressを利用する。

Contextはmode/origin/destination/schedule/selectionStatus/provenanceTypeを同じcurrentTripへ投影する。
railはlegsからderiveし、候補・realtime値と混ぜない。Context圧縮も同じ既存処理を使う。
transportPreviewはpure表示で、mode、両端、日付・時刻精度、manual未検証/予約未確認を示す。
共通scheduleラベルに任意の日付表示を追加し、独立した移動previewでは日付も失わない。

表示response中のselected transport add/replaceだけをitinerary progressとする。
失敗で未公開になったTool成功、delivered=false、状態だけの変化はTTFIにならない。
Oはmanual taxi + day、Pは便未定air + unscheduled。既存A〜Nを維持し、SmokeはOも、FullはO/Pを含む。

## 検証 / AC自己レビュー

| AC | 確認 |
| --- | --- |
| 航空をairとして保持 | 全非鉄道mode Domain、manual/Application、P Eval |
| 鉄道の計画事実を維持 | SelectedRailJourney既存全test、fixed projection/revalidation/遅延排除 |
| 未接続ferry/bus等もmanual | 全mode/各schedule精度、名前だけのPlace |
| 巨大optional interfaceなし | rail/non-rail/unresolved + provenance union、unknown field拒否 |
| 安全なProvider採用 | air/bus/ferry synthetic、ID/task/Trip/expiry/Evidence/retention/曖昧拒否 |
| mobilityの正確性 | mode集合、required/excluded、fixed分数、non-rail transfer/rail条件unknown |
| legacy安全移行 | 同じconverter、other維持、note warning、pure/deterministic |
| Agent/UX | Runtime・DOM、質問＋preview、Context、state非固定、hidden/internal TTFI負例 |
| writer gate | LocalStorage/server/dual-write/revision/会話削除に変更なし |

検証コマンドはnpm test、build、architecture:check、workspace:check、eval:agent:smoke/full。
結果はTypeScript 1,419件（frontend/modules 1,241 + backend 178）、build、architecture/workspaceすべて成功。
Smokeは保存済み12 + Ask 2 + Trip Progress 6、Fullは42 + Ask 7 + Trip Progress 16すべて成功。
Python unittest 13件、bundle budget、Lambda package checkも成功した。
専用format/lint scriptは存在しないため、既存書式・型検査・architecture check・git diff --checkで確認した。
O/PはどちらもTTFI=1、model calls=2、tool calls=1。表示されない内部成功を除く負例も維持する。
2026-09-13の既存AWS STS確認が`Your session has expired`で失敗したためLive Evalは未実施。
認証方式は変更せず、更新後は以下で再実行する。

```sh
npm run eval:agent:decision:live -- --suite trip-progress --profile full --case O-taxi --output-dir /tmp/raiquora-413-live-o
npm run eval:agent:decision:live -- --suite trip-progress --profile full --case P-air-provisional --output-dir /tmp/raiquora-413-live-p
```

scripted passは実モデル品質・latencyを証明しない。追加のReflection/model callはない。
Reservation#398、Money#412、realtime#393以降、server#388、CAS#389、全面UI#390は後続へ残す。
V2 writer未有効、実Provider API全面接続なし。本PRは#413のみをCloseする。
