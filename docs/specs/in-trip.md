# InTripContextSnapshot

## 契約・時刻・サイズ

`modules/trip/domain/in-trip-context.ts`がread modelとpure projectionを所有する。
Trip ID/revision/lifecycle、明示ZonedInstant、予定、Impact、通知、ReservationFact、environment source、location、truncationを持つ。
currentは予定上の位置であって到着/乗車実績ではない。fixed終了不明はunknown、window内はpossible-current、
dayはdate-current（宿泊checkout日exclusive）、timezone不明はunknown。DST/日跨ぎは既存schedule計算を共有する。
同じ分類内では採用順を保ち、未来予定だけnext/upcomingへ入れる。unscheduledはuncertainへ残す。

Placeは表示名のみ。鉄道は最大4legの番号/両端/計画発着だけ。生Journey/provenance/画像/raw payloadなし。
最大6Impact×4typed facts。severity/connection-buffer等を計算し直さず、内部Impact/Event/予約/Provider alert IDを除く。
不足はomitted/truncated、古いrevisionや期限切れはcurrent factsから除いてunknown。
環境値はImpact内のbinding済みweather/hazard typed factsを参照し、別のraw環境配列を作らない。
18,000文字上限。過大な入力は黙って安全条件を欠落させず失敗する。全体Agent予算24,000文字は維持する。

## 読取・整合性

`InTripContextApplication.read(principal, tripId)`でowner-scoped Trip GET→並列resource read→Trip再GET。
通知と無関係なinformational/unknown ImpactもSIGNALから取得する。pointerの再読込で読み取り中の観測変更を検出する。
取得・確認はそれぞれ最大4 pages（各12件）、計最大8 Query。Impact候補GETは最大48件。続きがあれば
truncated=trueとomittedの下限値（少なくとも1件）を残し、全件確認済みとはしない。
no-impactを後順位とした上で、現在予定→次2予定→直近後続4予定→その他、severity、status、
evaluatedAt/observedAtの新しい順、最後にstable IDの順で最大6件を選ぶ。
現在予定のattentionは遠い予定のaction-requiredより優先する。事実・severityそのものは変更しない。
Notificationの有無はImpact選別に無関係であり、未知情報も候補に残す。詳細はADR 0064を参照。
全history Scanやglobal owner一覧のfilterはない。Notificationは最新subject episodeを参照し、過去通知一覧を投入しない。
古いrevision/消えたitem/終端Trip/archiveはcurrent扱いしない。予約失敗は空の「予約なし」にしない。
read自体は各独立resourceのpoint-in-time viewであり、複数tableを跨ぐserializableな実世界snapshotを保証するものではない。

## 接続・公開gate

`createInTripContextApplication`は既存Repositoryを組成する。認証済みhostは
`createInTripContextHandler(application, authenticate)`へ渡す。公開Lambdaは引数なしで501。
bodyはversion/tripIdのみ。owner/時計/位置/Impactをpublic bodyから受け取らない。
現時点では新IAM権限・Terraform resourceを加えない。認証rollout時のread hostにはTrip/予約/ImpactのGet/Query、
通知tableのGet/Queryのみを付与し、write/Scan/worker起動権限は与えない。

Viewer→HttpInTripContextClient→Application read→loadInTripContext→既存Runtime Contextという配線。
in_trip以外はfetchしない。サーバ取得不可なら保存済み予定だけで相談し、Impact/通知/予約はunavailableとする。
通信失敗時の保存済み予定はtrip.currency=unconfirmedとし、最新版確認済みとはしない。
別revisionや終端への変更を取得できた場合は旧Tripで回答せず、Workspaceの再取得を求める。
別revisionのsnapshotをlocal Tripへrebaseしない。モデルへ固定Tool callを追加しない。
公開認証が閉じている現環境ではサーバ最新事実の自動取得は利用不可であり、実運用済みとはしない。

Locationはnot-requested/permission-denied/unavailable/availableを分離する。既定では取得しない。
explicit consent・有効座標・5分以内の観測だけをrequest-localに利用可能。Trip/PlaceSnapshotへの保存なし。
Context自体やowner/位置履歴を新しいログへ保存しない。

## 旅行中の残り旅程の変更案

## Application scope

`calculateInTripReplanScope` は共有Domainの副作用のないpolicy計算。既存Domainの `positionAt` と
`effectiveTripConstraints`、検証済みReservationFactを入力にする。UIとserverで同じ関数を使い、
時計や予約取得を関数内で行わない。`@raiquora/trip/in-trip-replan` をfrontend/backend双方が参照し、
server CASのauthorityからfrontendへの依存を作らない。

- definitely pastは必ずimmutable。previousも同じ既存時刻判定なのでこの集合に含まれる。
- 通常scopeは予定上current最大2件とnext最大2件。全remainingを暗黙許可しない。
- interaction hostの明示対象（`tripId/baseRevision/itemIds`、最大8件）があればその範囲を使う。
  既存UI focusは1件の明示対象。モデルTool引数でこのauthorityを作れない。
- fixedは保守的にすべて重要予定とする。bookedリンク、effective hardに関わる予定も保護する。
  trip-wide hardは関連を名前/発話から推測できないため全itemを保護する。
  保護対象の提案には明示target、applyにはさらにexact Proposalへの確認が必要。
- Reservation reader未取得は全itemを保護する。bounded Contextの8件だけを使って予約なしとは判定しない。
- day/window/unscheduledをfixedや実際の完了へ昇格させない。位置情報はscope入力ではない。
- addは変更可能な予定直後だけ。moveは保護区間をまたがない。新規過去予定も拒否する。
- TripRequest/hard条件/既存仮定/lifecycleを同じ残り旅程Proposalで削除・上書きしない。
  別途の条件変更や状態確認は既存境界へ残す。旅行終了/cancelledでは再計画能力は使えない。

`InTripReplanScope` はrequest-localの導出結果であってDomain stateや別Plannerではない。
Agentへのprojectionは最大12対象の理由/最大8mutableだけ。未掲載は許可しない。
初期Contextにscopeを載せるのはhostの明示targetまたはUI focusがある場合だけで、通常の旅行中の説明・
独立経路検索には注入しない。非注入でもProposal Toolの`previewInTripReplan`は必ずdefault current/nextを
検証する。表示しないことは権限の緩和ではなく、保護対象には引き続き明示targetが必要。
User intent/どの候補が良いか/追加検索/質問はBedrockが判断し、固定質問順や発話routerを追加しない。
保護された対象の自然言語だけからの権限昇格はしない。必要な明示対象はWorkspaceで選択する。

## 提案・根拠・確認

候補は既存のID解決→verified rail timetable / Provider保持許諾→selected snapshot→Proposalを通す。
raw Journey、realtime補正、予約状態はTripへ入れない。別の候補を選ぶ操作はreplace。
独立駅間の検索は`search_direct_routes`、現在区間の採用変更は`propose_candidate_selection`で分離する。
Activityも既存候補採用を使い、天気や施設名から屋内/営業時間を生成しない。

scope検証後のpure previewに既存Feasibilityを適用する。変更によって古いmovement factのbindingが
無効になればunknownのまま。Reservation conflict/hard violationを除去して成立とはしない。
draft保存は成立認定ではなく、ready認定は従来の`requireFeasibleTrip`だけ。
UIは保持/変更予定、保護理由、予約自体を変更しないこと、全Feasibility issueを表示する。
Agentにはprivate IDを除いたbounded issue code/status/itemだけを返す。

confirmationKeyはexact Proposal + 保護理由 + 全ReservationのID/revision/statusの集合に結び付く
request-local確認値。Agentに渡さず、HTTP bodyをauthorityにしない。予約変更確認keyは従来どおり併用する。
時計はkeyに含めないが、確認時とserver prepareで現在時刻からscopeを再計算するので、
待っている間に過去になった予定は拒否される。候補再検証は既存writer hostの責務を維持する。

Tool登録時のTrip revisionを実行前とasync候補解決後にも検証する。model入力からTripが変わったら
Proposalを最新revisionに載せ替えず拒否する。Repositoryのmutation receipt retryはprepareを再実行せず
元の成功結果を返す。Reservationのcancel/link/updateは呼ばない。

revision conflictは通常の「別候補を試せる」Tool失敗と区別し、Applicationがこの実行を終了する。
それまでの未保存Proposalも破棄し、同じbatchの後続Toolを実行せず、新しいProposalが必要と表示する。
これはcurrentnessの境界であって、発話内容からToolを指定するrouterではない。

既存のnative Tool contractとAPI allowlistの不整合も解消する。既に公開されているActivity/
非鉄道の提案能力、および`propose_itinerary_removal_or_move`を、requestとresponse両側で
同じ許可集合として検証する。保存Toolや新しい公開writerは追加しない。
モデルがTool名を`selectedAction`へ書く不正応答は実行しない。in-trip scopeがある場合だけ
一度まで構造化contractの訂正を要求でき、再び不正なら失敗する。常時reflectionは追加しない。
訂正時にモデルの内部思考を履歴/traceへ保存せず、Evidence/Claim validationは維持する。
Tool利用時のnative契約は明示scopeのContextに置き、全turnのSystem Promptへ重ねていた
変更案の例示は削除する。施設候補の採用とremove/moveの責務は既存`decisionSupport`形式で
区別する。Toolの公開集合・schema・モデル・temperature・検証境界は変更しない。

## Trip旅行モード

旅行モードは選択したServer Tripの一時的な表示であり、Trip・予約・完了実績のwriterではない。
旅程詳細から任意のTripをプレビューでき、Homeには時間分類が`current`のTripだけ入口を表示する。
常設の「旅行中」ナビや空の旅行モードは追加しない。

`lifecycleState === in_trip`では認証済み`POST /api/trips/in-trip/v1`を読み、既存のowner-scoped
`InTripContextSnapshot`を表示する。current/next/upcoming、保存済みImpact、Reservationの
available/unknown/unavailableをそのまま保持する。取得失敗を平常、晴れ、予約済みへ変換しない。
Trip IDまたはrevisionが画面表示中に変わった場合、遅れて届いたContextを破棄して詳細へ戻る。

未来・過去・中止等のTripは保存済みscheduleだけからプレビューする。「予定上の現在」と明記し、
実際の乗車・到着・訪問・完了を認定しない。旅行モードを開く操作はlifecycle mutationを送らない。

列車はSelectedRailJourneyに保存された列車番号、出発・到着駅、計画時刻だけを表示する。地図は
[Trip詳細の4タブ](trip-workspace.md)と同じ実経路照合を使う。AI相談は生の要求を既存の対象固定
Server Conversationへ送り、選択itemだけをbounded UI focusとして渡す。変更案は既存#397の
Proposal・保護範囲・明示確認・CASを通り、画面独自の再計画器を持たない。

ChromiumによるPC/スマホの最終視覚確認は実行環境にブラウザがないため保留し、ローカル環境で行う。
