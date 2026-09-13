# Trip V2コアの導入 (#385)

正本は[#382](https://github.com/ymho/transitforge/issues/382)、[#415](https://github.com/ymho/transitforge/issues/415)、
[ADR 0052](../decisions/0052-establish-trip-v2-contract-and-migration.md)、[最終契約](trip-lifecycle.md)。
本書は最終契約を変更せず、main `845f17d`から#385で実装した部分と未導入部分を区別する。

#414によるPlaceの統合・利用箇所・保存許諾・legacy部分変換は[Place導入記録](trip-place-snapshot.md)を参照する。
#386による共通schedule・日時validation・Context/表示projectionは[Schedule導入記録](trip-schedule.md)を参照する。
#387による同じTripのRequest・仮定・legacy mapping・評価境界は[Request導入記録](trip-request.md)を参照する。
#383による同じTripの計画/旅行状態・注入Clock・Proposal・legacy mappingは[状態導入記録](trip-state.md)を参照する。
#410による同じunionのActivity・add・候補採用・legacy mappingは[Activity導入記録](trip-activity.md)を参照する。
#403によるsummary、items由来の順序付き地点、legacy/Context/表示の3分離は[地点projection導入記録](trip-places.md)を参照する。

## 現行モデル・利用箇所の棚卸し

| 型 / 利用箇所 | 現在の意味 / #385での扱い |
| --- | --- |
| `TravelCandidate` / `createTravelCandidate` | 比較候補の既存Domain型。旅程ではない。鉄道発見前にも使えるようjourneyを任意化。既知価格集計・不明価格の非推測は維持 |
| `TravelPlan` / `TripJourneyPlan.journeys` | 往復と宿候補の検索応答束。引き続きlegacy producer/UIを支えるがV2の保存型には使わない |
| `TripPlan` / `StayPlanItem.options` | legacy編集・保存モデル。#404のprovider読取と#405の原子的Patchを維持。writer gate前なので既存形式の読書きを継続 |
| `trip-plan-panel.ts` | rail表示は先頭候補、宿の地図選択はoptionsを読む。先頭表示は採用の証拠ではない。V2 UIへの移行は#390。候補比較を消さない |
| `trip-plan-repository.ts` / `conversation-session-repository.ts` | JSON reader、session別保存、会話削除連動。#385では変更しない。#388の原本保全・writer切替と一緒に置換 |
| `viewer-agent-runtime.ts` | 往復生成・帰路開始時刻・区間再検索・stopover・説明でjourneysを読む。いずれもlegacy検索処理のまま。V2へ先頭経路を採用する経路は追加しない |
| `search-journeys-tool.ts` / `compare-journeys-tool.ts` / `tool-result-evidence.ts` | 検証された検索・候補比較・Evidence生成のまま。運行事実をTripへ移さない |
| `selectTripPlanAccommodation` / `tripPlanController.selectAccommodation` / composition | legacyでは全stayへ同じ宿を代入。#385の新しい採用境界では対象item ID必須で、他stayは変更しない。legacy導線のitem-ID UI移行は#390へ残す。#403はV2 read projectionのみ |
| `MapTravelCandidate` | 地図カードの既存表示projection。新しい永続候補モデルにしない。V2ではcandidate IDを新usecaseへ渡す導線に移行する |
| `agent-context-snapshot.ts` | 従来の先頭経路時刻を採用済みとして渡す処理を廃止。legacy railはunresolved、候補と検索時点見込は別field。V2 Tripのselected schedule projectionにも対応 |
| `JourneyRouteResult` / `TrainOperation` | 前者は遅延も含む検索応答、後者は現在の遅延/行先等。どちらもV2保存型ではない |

## 実装した同一Tripの範囲

`modules/trip/domain/trip.ts`に不変UUID、schemaVersion=2、初期revision=0、title、作成/更新日時、
順序付きitemsを持つ。item IDは非空かつ一意。生成関数にUUID/時刻を注入し、会話IDや目的地から作らない。
操作ではIDを変更できない。Domain型はreadonlyで、生成/適用結果は入力とオブジェクト参照を共有しない。

- transport.detailは未検証unresolved、rail selected + SelectedRailJourney、または#413の非鉄道selected + manual/provider provenance。
- stay.selectionはunselected、または選択済み1宿。#400でinlineを同一のAccommodationSnapshotへ統合した。
  商品identity・共通PlaceSnapshot・採用日時・宿泊日・durable出所だけを保持する。
  AccommodationOffering/TripAccommodation、価格・空室・画像・review・予約状態は埋め込まない。
- #386で全itemへ共通scheduleを追加した。不明時刻は明示`unscheduled`、rail/stayは計画事実のprojectionを検証する。
- #387でrequest（constraints/assumptions、任意goal）を追加した。空Requestは条件未把握であって日帰り等のdefaultではない。
- #383でplanningState/lifecycleStateを追加した。初期inspiration/pre_tripは日程確定や将来予定の証明ではない。
- #410でactivityと必要最小限のaddを追加した。場所なし・日時未定を許し、候補採用は許諾を確認する。
- #411導入後も未知のpartyを正常なdefaultで埋めず、未設定または明示仮定として扱う。
  別名の暫定Tripや別のItinerary正本を増やさない。
- `TripPatch` / `TripUpdateProposal`は既存itemのreplaceと、#387で追加したrequest patchを持つ最小契約。
  #383でplanning/lifecycle patchを追加し、候補採用とdraft化を同じ原子的Proposalで扱う。
  `applyTripProposal`は全件検証し、失敗時に元Tripを変えない。存在しない対象、ID変更、異なるitem種別は拒否。
  **これはメモリ上の確認可能な変更であり、revision/updatedAtを増やす本番writerではない。**
  #389が同じ契約へ他操作、baseRevision、mutationIdと更新時刻/CASを追加する。

## 検索 → 計画snapshot → 現在の観測

`selected-rail-journey.ts`の`selectRailJourney`はApplicationが解決した候補と出所時刻表を使う。
単に型が一致するモデル出力をverifiedと呼ばない。
既存ExternalSourceEvidenceへkind=timetableを追加し、provider-scheduleの時刻表Evidenceだけを採用する。
天気やWeb記事のEvidenceを列車計画の検証元として代用しない。

保存fieldはserviceDate、selectedAt、legs（id/serviceDate/serviceUid/trainNumber/駅名/停車順/
scheduled発着instant）、transfers（leg参照/必要時間）、provenance（検索参照/検証時刻/
明示したsource Evidence/各legの入力sourceId・serviceDate・digest/validator version/transferPace）だけ。
駅は#414のPlaceSnapshotで時刻表の名前と出所を保持する。station IDを名前から発明せず、stop indexとの照合を維持する。
全体発着地/時刻は最初・最後のlegから取得でき、独立した重複値を保存しない。

- sourceId + contentDigest + serviceDateで入力を解決し、serviceUid + trainNumber + stop index + 駅名 + scheduled値を照合する。
  番号だけの結合、同駅再訪の曖昧な照合、複数同UID、欠落入力を拒否する。
- 入力は既存`TrainIndex`の発/着event付きscheduled stops。Backendのconnection/direct indexをそのまま
  無検証でキャストしない。現在の検索wire応答はdigestやstop indexを持たないため、その応答だけでV2採用を有効化しない。
  `CandidateSelectionPort`の実装は信頼した日付別入力からID対応を検証し、immutableな入力全体と乗換規則のdigestを保証する責務を持つ。
  #385はこのPort/usecaseとDomainを用意するが、BrowserやLLMから証明・raw indexを受け取るAPIは公開しない。
- scheduled optional値がない旧結果は、未補正時刻が時刻表と直接一致する場合だけ利用可能。
  delayの引き算や補正済み時刻の改名はしない。移行時の旧経路にはこの採用を自動実行しない。
- `requiredTransferMinutes`を既存探索engineから共通関数に抽出。同じpace/駅ルールで計画上の接続を再検証し、
  遅延がある時だけ成立する接続を拒否する。新しい探索器・Plannerはない。
- 業務日+24時超minutesを日付を失わずoffset付きinstantへ変換。現在の鉄道入力のAsia/Tokyoに限定。
  #386で共有ZonedInstantと日時validationへ統合した。鉄道instantは同じ瞬間の`+09:00`表記へ揃え、
  zone/offsetの一致を必須とした。計画分や4時境界は変更しない。
- 生のJourneyRouteResult、delay/status、補正時刻、混雑、現在位置、unknown field、raw、取得URLをコピーしない。
  legs/provenanceもallowlistで新規構築。Trip/Patch検証でも未定義キーを拒否する。
- `revalidateSelectedRailJourney`は入力の欠落/digest/時刻/乗換規則/validator変更を検出する。
  再検証結果はbooleanでありsnapshotを上書きしない。UI向け詳細reason/影響評価は後続。
  選択時validationとは独立して現在の時刻表を保存済み計画と直接照合する。後日再取得したEvidenceの
  retrievedAtが元verifiedAtより新しいこと自体は不一致ではない。元snapshotの採用/検証時刻は保持し、
  選択時の「Evidence取得→候補検証→採用」の順序制約も緩めない。

計画09:00、遅延10分の場合はsnapshotに09:00を保持する。検索時の09:10は候補/観測側、
将来の次予定への影響はTripImpact側。予定を再観測で無言更新しない。

## Candidate選択のApplication境界

候補比較は[取得済み事実のAssessment (#406)](candidate-assessment.md)を使う。採用とは別のpure計算で、
同じCandidateSelectionPortの取得済みrecordを読む。評価から選択や時刻表再取得を起動しない。

`frontend/src/usecases/trip-plan/select-trip-candidate.ts`:

1. UI/AIはcandidate ID、対象item ID、task ID（宿ならProvider内の候補ID）だけ渡す。
2. 注入Portがtask-localな既存TravelCandidateと検証情報を解決。期限/所属Trip/task/ID/重複を確認する。
3. railは時刻表をロードして上記変換。宿はAdapterの保存許諾と候補に一致したEvidenceが必須。
4. 1件の明示replaceとplanning patch（#383）のProposalを作る。提案だけではTripを変更しない。
5. `confirmCandidateSelection`で明示確認時に再取得・再検証する。プレビュー後に内容が変われば再確認へ戻す。
   selectedAtは実際の確認日時。候補A→Bもreplaceで、他itemや未選択候補を混ぜない。

この段階でPortのproduction writerへの配線はしない。#388/#389のgate後に同じusecaseを使用する。
LLM提供のTrip/Patch本体だけを信頼して永続化する入口はない。認可・revision/CASはまだ完成したとしない。

## 単一legacy converterとwriter gate

`convertLegacyTripPlan(plan, { tripId, createdAt })`は唯一の入口。Adapterが固定した移行ID対応と
V2生成日時を注入する。同じ入力/引数で同じ出力。旧IDをUUIDと仮定しない。

- legacy railは1件/複数を問わずunresolved。先頭候補、delay値、移行日時で採用の証拠を補わない。
- stayはoptionsをコピーしない。旧accommodationも現時点ではprovenance/許諾を移行できないため
  unselected + #400警告/deferredにする。同じ入口で利用者の目的地名だけを未選択placeへ保持し、Provider施設情報をmanualへ偽装しない。
- #413でlegacy manual移動を同mode・両端名称のmanual計画へ接続した。不正値/noteは警告と原本保持。#410でsightseeingをActivityへ接続した。
  #414の同じconverterのPlace許諾付きmappingを使い、完全変換時だけdeferredを解消する。部分変換は警告と原本保持を残す。
  #386で日付はday/宿泊day spanへ移し、同じplaceMappingsにscheduleも返す。不正日付は警告とunscheduled。
  #387で同じ入口に旧TripContext/conditionsのRequest mappingを追加した。出所/必須度はlegacy+未確認で保持し、
  曖昧な時刻・比較対象は警告にする。元item ID/順序は原本に残り、変換できたitemのID/相対順序も維持。
- 原本を変更せず、`requiresLegacyRetention: true`とwarningsを常に返す。これは完成したimportではない。
  未実装fieldやdeferred itemがある状態で旧rawを削除してはいけない。元データはログ/Trip内へコピーしない。
- **LocalStorageの現行正本/writer、会話削除、server Repositoryは変更しない。dual-writeもない。**

## AI Context / 評価

`currentTrip`は採用計画（legacy railは未採用明示）。`travelCandidates`は比較候補、`realtimeFacts`は
検索時点見込を含む外部情報として分離する。旧応答に観測日時がないためfreshness=unknownと明示する。
`currentJourney`は従来どおり直前検索の照会/比較Contextであり採用Tripではない。
Contextは既存privacy filter/件数/深さ上限を通す。#387のRequest投影はID/条件/仮定の参照を切り捨てず、
全体Context予算に収まらなければ明示失敗にする。Tool数・呼出し上限・Provider・LLM判断権限は変えない。

Domain/境界テストはdelay/extra field排除、provenance欠落、別日/同駅再訪、日跨ぎ、複数leg、
遅延前提乗換、再検証、原子的replace、期限/所属/保存許諾、確認前後の不変、legacy決定性を扱う。
既存Journey scenario、TripPlan/parser/UI、Agentの回帰は全体testで確認する。
Context変更があるためSmokeに加えて保存済み観測のFull Evalを実行する。
live評価は設定済みAWSセッション期限切れで未実施。保存済みFull Evalの成功を実モデル品質の保証とはしない。

## 後続ownership（未実装）

| Issue | 同じTrip/同じconverterへ追加する責務 |
| --- | --- |
| #383（導入済み） | planning/lifecycle・時刻派生評価・状態Proposal。[状態導入記録](trip-state.md)参照。item実績や自動完了は未導入 |
| #387（導入済み） | TripRequest/constraints/PlanAssumption、最小評価、Profileと今回条件の区別。[Request導入記録](trip-request.md)参照 |
| #400（導入済み） | [宿泊Snapshot](trip-accommodation.md)。商品とPlace identityの分離、許諾・採用時検証、保守的legacy mapping |
| #403（導入済み） | [表示要約と採用済み地点projection](trip-places.md)、同一converter、Context、pure UI helper。legacy選択UI移行は#390 |
| #410（導入済み） | Activity、add、deferred sightseeingの部分/完全変換。[Activity導入記録](trip-activity.md)参照 |
| #411 / #412（導入済み） | [TripParty](trip-party.md)、[原通貨Money](trip-money.md)、宿/体験の候補価格観測と許可された宿Snapshot価格。writerは未有効 |
| #413 | [非鉄道transport](trip-transport.md)導入済み。外部API全面接続・料金・予約・リアルタイム監視は未有効 |
| #388 / #389 | server認可/保存/取込、全Proposal/UIのrevision/CAS/冪等性、writer切替。新しいDomain converterは作らない |
| #390 | 同じTrip/Proposalを扱うUI。legacy表示を採用証拠にする移行は禁止 |

## #385 AC自己レビュー

| AC | 実装・確認 |
| --- | --- |
| 複数経路をTripへ保存しない | detailはunresolvedまたは1つのSelectedRailJourney、未知キーも拒否 |
| 生JourneyRouteResultを保存しない | 独立型 + allowlist変換 |
| delay/status/補正時刻が混入しない | scheduled入力照合、深い未知キー検証、09:00/09:10 fixture |
| 選択済みrailを一意判別・観測と照合できる | selected discriminator、serviceDate/UID/番号/source/digest/stop index |
| Stayに候補一覧を混在させない | selection内1宿、optionsなし、他stay不変テスト |
| Candidate A→Bは明示Proposal/Patch | ID解決、replace、確認前は不変 |
| legacy先頭候補を自動選択しない | 1件/複数ともunresolvedと警告 |
| pureで拡張可能なlegacy変換 | 単一入口、引数注入、原本不変・同入力同結果 |
| 既存検索・比較を失わない | 探索アルゴリズム/legacy UIを維持、全体test |
| writer/server保存は未有効 | Storage/Repository/会話削除の変更なし |
