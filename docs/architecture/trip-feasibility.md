# Trip Feasibility (#402)

正本方針は #382/#415、判断は ADR 0052〜0055 と [ADR 0056](../decisions/0056-evaluate-adopted-trip-feasibility.md)。
対象は**採用済みTrip**。候補比較 (#406)、予約事実 (#398)、リアルタイム影響 (#401等) と混在させない。

## Before / After・変更ファイル

| 現行 | #402 |
| --- | --- |
| #387の個別hard constraint評価 | 同じ`trip-constraint-evaluation.ts`へorigin/destinations/duration/budgetを追加し全体から再利用 |
| Schedule/Place/Rail/Stayは構造・採用validationのみ | `trip-feasibility*.ts`で精度別時間関係、予定間移動、訪問条件、予約を派生評価 |
| readyは`validateTripState`で一律禁止 | 保存済みreadyは読める。Applicationが今回のready認定を評価・拒否する |
| #389のprepare→CAS/receipt | `TripApplication`のprepareで変更後Tripを評価し、同じCASへ渡す |
| Workspaceに予約ラベルのみ | 成立/不成立/未確認、該当itemの理由、ready確認の拒否理由を表示 |
| Agentに個別constraintと予約Context | top-level `tripFeasibility`をcurrentTrip/candidates/realtime/reservationsから分離 |

追加の主要ファイルはDomainのcontract/facts/schedule/evaluator/ready predicate、Backendのread port、
Agentのbounded projection、UIのlabel/render helperと各colocated test。既存Trip/Request/Reservationの正本型は変更しない。

## 出力

`TripFeasibilityEvaluation { tripId, tripRevision, status, issues, evaluatedAt }`。
issueはcode、severity、violated/unknown、itemIds、必要に応じreservationIds/constraintIds/evidenceIds、
数値等のdetails。日本語本文・Provider raw・予約番号を含めない。日本語はpresentationにのみ置く。

1つでも明確なviolationがあればinfeasible、違反がなく必要なunknownがあればunknown。
必要な評価が全て成立する場合だけfeasible。空Tripもunknown。scoreやモデル確信度は使わない。
未確認assumptionはunknown。effective hardの却下/overrideの既存意味は維持する。

## 時間・移動

- fixedの開始/終了は明示offsetのabsolute instantで比較する。終了欠落はunknown、0分とはしない。
- 採用順を保った全pairを調べ、間に未定itemがあっても既知の衝突を見逃さない。
- window + durationは最早終了と最遅開始を計算する。どの配置でも前itemの終了が次開始に間に合わなければ違反。
  全ての配置で両立すればpairはsatisfied、配置次第ならpossible。後者はcode `schedule_window_possible`。
  window自身の未配置はunknownのまま。所要時間のあるbounded windowの精度だけならreadyを妨げないが、配置次第で衝突するpairはreadyを阻害する。duration不明はblocking unknown。探索optimizerではない。
- day/unscheduledは時間衝突を断定せずunknown。ブラウザtimezoneや00:00を補わない。
- 連続itemのend place→start placeを比較する。同じ`PlaceRef`を#414で同定できる場合だけ移動不要。
  名前一致・手入力名・別Providerの同名は同一視しない。別地点のActivity間を0分にしない。
- 移動factは前後の採用itemに結び付く。必要分数と日時の余裕を比較し、不足はviolation、fact/時間不足はunknown。
  周遊・再訪の順序を維持し、Trip内に明示したTransportも同じ隣接関係で扱う。
- selected railは`validateTrip`→既存SelectedRailJourney validationとそのscheduled scheduleを使用する。
  transfer/pace/policy/provenanceの検証を別実装しない。遅延・補正時刻・混雑を入力しない。
- 非rail採用は便の運行/所要時間を必ずしも証明しない。取得済みのduration factがなければ未検証。
- selected Stayは既存check-in/out→day spanのinvariantを保つ。時刻を捏造せず時間レベルはunknown。
  宿泊中のActivityがあるだけで衝突と断定しない。日付の明確な矛盾は既存snapshot/schedule validationとhard dates/durationで検証する。
  前予定からの到達日がcheckout日を越える、後予定への出発日がcheck-in日より前になる場合は、採用順の日付矛盾として違反。
  予定内の宿泊中の外出を拒否しないため、Stayをcheck-in日からcheckout日までの占有時間として扱わない。
  比較はStayの明示timezoneを使う。zone欠落・相手の時刻欠落はblocking unknown。

## Hard constraints / Money

既存effective hard evaluatorだけを拡張する。別DSL/候補への変換はない。
希望先は順序付き採用Place projectionと比較し、連続endpoint/Activityの重複を再訪と数えない。
同一Providerの比較可能なIDで不一致を証明できる場合だけ違反。名称だけの希望・不明な地点はunknown。
durationは明示zoneの日付境界からdays/nightsの範囲を比較し、windowをexactにしない。
arrival/departure/mobilityは既存のscheduled事実を使用する。既知違反は他の情報不足で消さない。
主観的要求、未知の車可用性、複雑なitem別Profile override等、既存Evaluatorで証明できない条件はunknownのまま。

budgetは既存Moneyのsafe integer minor units、add/compareを使う。採用itemごとに完全な費用coverageが
取得事実で確認できる場合だけ合計する。入力は同じitem/partyに結び付く。欠測を0円にしない。
選択宿の`observedPrice`だけでは全泊・部屋・人数・税のcoverageが不明なので、それだけで完全な費用にしない。
Candidateの価格・未採用宿を足さない。異通貨、重複費用fact、overflowはunknown。
per-personは確定した今回partyがある場合だけ、同通貨の上限を人数倍してTrip総額と比較する。
価格・visit factが必要ないfree-time itemでもbudget対象なら費用coverageは必要。無料を推測しない。

## Reservation

ReservationFact以外を受け付けず、private/raw fieldは拒否し評価へコピーしない。
bookedのstartsAt/endsAtがlinked fixed itemの同じ端点と異なる場合は`reservation_conflict`。
予約の固定された開催区間とitemの区間を一致させる保守的な契約であり、到着猶予/途中退場は推測しない。
通常のday/window/unscheduled/終了不明/予約時刻なしは`reservation_time_unknown`。
selected Stayでは明示timezone上の予約開始/終了日がcheck-in/out日と異なれば違反。矛盾がなければ時刻精度の未確認を`stay_reservation_time_precision`として残す。予約必須・取得失敗・unknown statusは別のblocking issueであり、この精度許容では消さない。
unknown statusは未確認、cancelled/not-required/not-bookedはbookedとして扱わない。
予約必須の取得factと明示not-bookedだけが揃えばviolation。記録なし・unknownを現実の未予約と断定せず予約確認requiredをunknownとして返す。
dangling linkは該当ID付きissue。unlinked bookedもunknown。自動link/delete/cancelはしない。
reader未設定/失敗はundefined、完全取得した空リストとは区別する。

## 取得済みexternal input

`TripFeasibilityFacts`はtripId/revision、任意ReservationFact[]と
`ExternalTravelInformation<TripFeasibilityFact>[]`。既存status/freshness/ExternalSourceEvidenceを再利用する。
各factのsubjectは既存のItineraryItemを参照コピーしたもの（別item型ではない）。評価時に採用itemとexact比較する。
同revisionのProposalでもschedule/Place/選択が変われば旧factは使えない。costは今回partyも照合する。
構造・種別・Evidence・未来のretrievedAt・observedAtの順序を検証し、freshかつvalidUntil有効の場合だけ利用する。
validUntilは取得factを再照会せず信頼できる期限であり、旅行終了時刻とは別。旅行日時の適用範囲はsubject全体への
Adapterの照合契約とする。source IDだけでその照合を証明したことにしない。失効・失敗・未知はunknown。
矛盾するEvidence IDやraw extra fieldはinvalidとして、他の既知violationを失わずfail-closedに扱う。

Backendの`TripFeasibilityReader.external(principal, proposedTrip)`、Workspaceの
`getFeasibilityExternalFacts`は**信頼された取得Adapter用のread seam**。Agent/HTTPにはfact登録APIを公開しない。
現在は実Providerへの新しい配線はないため、未取得の営業時間/地上移動/費用は未確認になる。
全itemを巡る外部API pipeline、Tool固定順、独立Evidence Repository、Hazardモデルは追加しない。

## ready / revision / failure

- `requestsReady`の明示planning Patchだけを認定対象とする。overall statusとは別の`blocksReady`をUI/Applicationで共有する。
  UIは該当理由を表示し、checkboxやモデルの説明で解除できない。通常draft/修正は可能。
  全violationと、以下の明示例外以外のunknownはblockingとする。新しいcodeもデフォルトでblocking。

| non-blocking code | 許可する意味（unknownは残す） |
| --- | --- |
| stay_time_precision | 採用済みStayの正当なday span。固定時刻へ変更しない |
| stay_movement_time_precision | 取得済み移動factと日付順に矛盾がなく、不足するのがStayの正確な時刻だけ |
| stay_reservation_time_precision | booked Stayの日付に矛盾がなく、正確な利用時刻の照合ができない |
| window_time_precision | 所要時間のあるbounded windowの未配置だけ。配置衝突のschedule_window_possibleは別にblocking |

route未取得、unresolved transport、hard unknown、予約取得失敗・予約必須のunknown、外部fact不正等は引き続きblocking。
`hasReadyBlockers`/`requireFeasibleTrip`は完全な新規評価へpolicyを適用する。Agentの省略Contextは認定に使わない。

- Controllerとserver sourceは実際のpost-Proposal previewを評価する。外部から渡された評価を証明として採用しない。
- Backendはowner取得→既存Proposal apply→取得済みfact read→同じDomain評価→CAS/receipt。
  previewはbaseRevisionを維持する。CASが成功した時だけrevisionが+1になり、次回評価は新revisionを使う。
- 古いProposalは既存revision検証で拒否し、評価中の更新はCASで拒否。自動rebase/semantic mergeなし。
- 新規createでreadyを渡す場合も同じgateを通す。HTTP bodyのfeasibility/authorityはreject。
- 拒否はHTTP seamで409 `feasibility-required`。予約変更確認の`confirmation-required`と区別し、clientは成立性未確認/不成立と表示する。
- 過去の成功receipt retryは再適用/再評価せず元の結果を返す。current評価は別GETから再計算する。
- 保存済みreadyが後でunknown/infeasibleでもread/schema validationは成功し、状態を自動で戻さない。
  ReservationとTripのcross-resource raceは#398の既知制限のまま。CASはTripの競合だけを防ぐ。

## UI / Agent / privacy

Workspace全体へ「成立性: 成立 / 不成立 / 未確認」、各itemへ関連issueを表示する。
未確認はamberで、文字でも明示する。ready変更案では**変更後**の評価を表示して確認を制限する。
non-blocking unknownのみなら確認を許可し、「準備完了でもすべて確認済みではない」とUI/Agentへ明示する。
評価をTripやSessionへ保存しない。sourceから都度再評価し、別会話や古い取得結果へfallbackしない。
Agentへはtop-level `tripFeasibility`だけをbounded projectionする。個別のhard評価の別コピーはRuntimeの
currentTripから除き、異なる費用coverageで矛盾する二重評価を出さない。既存Context readerは旧field互換を維持する。
violation優先で24issue、totalIssueCount/truncatedを保持する。全体statusを省略subsetから再計算しない。
予約番号、Provider private detail、raw、自由文detailsは送らない。圧縮Contextでも結果を保持する。
LLMは説明と変更案、Tool選択を担当する。自動ready/修正や違反の打消しはできない。

## 検証 / AC自己レビュー

| AC | テスト/実装 |
| --- | --- |
| fixed overlap、時差、nonadjacent、全3値、pure/revision | trip-feasibility.test.ts |
| window必須衝突/成立可能/不明、day、unscheduled | 同上、orderedScheduleRelation |
| 移動不足、未取得、同名別ID、周遊 | 同上、constraints.test.ts |
| selected rail、transfer回帰、realtime拒否、未選択交通 | 同上 + 既存SelectedRailJourney/Transport全test |
| hard sat/violated/unknown、dates/duration/destinations/mobility | 同上 + 既存hard evaluator test |
| 費用coverage、異通貨、未取得 | trip-feasibility-constraints.test.ts |
| booked整合/矛盾、不十分schedule、5状態、dangling/private | trip-feasibility.test.ts |
| ready未確認/違反拒否、同revision変更後評価、stale、CAS race/retry | Backend trip-feasibility.test.ts、Workspace test |
| selected Stayをdayのままready認定、時間捏造なし、日付順、blocking unknownの維持 | trip-ready.test.ts、trip-feasibility-stay.test.ts、Backend/Workspace/Agent Context test |
| UI全体/該当item、unknown非green、確認不能 | presentation/trip-feasibility.test.ts |
| Agent非private、圧縮、モデルで違反消去不可 | Context test、AC/AD/AE Runtime Eval |

Smoke/Fullに AC impossible itinerary / AD reservation conflict / AE unknown factsを追加。
保存済み42ケース、Ask+Progress A〜G、Trip Progress A〜ABの閾値は維持する。
新3件は本番Runtime/registry/Proposal/controllerを通すscriptedモデルIOで、実モデルの品質証明ではない。
追加model/tool呼出しは0。Context投影による入力token増加とpure評価のCPU時間のみ。全pair評価はO(items²)。
通常評価はAPI課金なし。Liveは従来のAWS認証期限切れによる未実施記録を維持し、今回再実行しない。
test/build/architecture/workspace/smoke/full/infra/lambda/diffの結果はPRへ記録する。

## Migration / 非対象

Trip schemaVersion/revision、converter、LocalStorage、server storage DTOに新fieldを追加しない。migration不要。
本番writer/認証gateは解除しない。外部APIの自動全取得、予約API、Hazard #401、共有 #399、Checklist全面実装、
主観的疲労、全世界スケジュール最適化、自動修正・AI mergeは後続へ残す。
