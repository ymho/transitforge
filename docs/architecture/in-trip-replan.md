# 旅行中の残り旅程の変更案 (#397)

## 棚卸し: 現行 → 今回 → 残す責務

| 既存正本/処理 | 今回の利用 | 変更しない責務 |
| --- | --- | --- |
| `modules/trip/domain/trip.ts` の `TripUpdateProposal {tripId, baseRevision, summary, patches}` / typed `TripPatch` | 同じ型によるremove/move/add/replace preview。新Proposal型はない | revision増分、item invariant、Request/lifecycle契約 |
| `TripApplication.execute` → Repository.applyMutation(prepare) → CAS + mutation receipt | prepareへ旅行中scope再検証を追加 | #389のexact revision、同mutationId再試行、atomic保存 |
| `ReservationFact` / bookedReservationChanges / reservationChangeKey | 完全なreadを保護判定へ。予約番号・Provider privateを使わない | #398予約更新、予約の独立CAS |
| #396 InTripContext / positionAt / Application Evidence | 同じschedule精度、保存済みImpactをモデルの判断根拠にする | 現在地推測、Impact/severity再評価をしない |
| `registerTripProgressTools` のcandidate/activity/transport/request提案 | 全V2提案の共通出口でscopeを検証。削除/並べ替え能力を追加 | rail timetable/retention validationは既存採用入口 |
| Workspace preview/confirm、server workspace source | before/after、保護理由、予約影響、成立性、明示確認 | public writerは引き続きgate、#399認証rollout |

主要変更: `modules/trip/domain/in-trip-replan.ts`、frontendのtrip-plan controller/source、
`frontend/src/usecases/agent/trip-progress-tools.ts` / `agent-decision-context.ts`、
`frontend/src/adapters/bedrock/viewer-agent-runtime.ts`、`trip-workspace-proposal.ts`、
`backend/agent-api/src/usecases/trip-application.ts`。各境界のテストとAQ〜AUを追加する。
Trip/DTO/schema/Storageにfieldを増やさず、migration・dual write・新Repositoryはない。

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
非鉄道の提案能力、および今回の`propose_itinerary_removal_or_move`を、requestとresponse両側で
同じ許可集合として検証する。保存Toolや新しい公開writerは追加しない。
モデルがTool名を`selectedAction`へ書く不正応答は実行しない。in-trip scopeがある場合だけ
一度まで構造化contractの訂正を要求でき、再び不正なら失敗する。常時reflectionは追加しない。
訂正時にモデルの内部思考を履歴/traceへ保存せず、Evidence/Claim validationは維持する。
Tool利用時のnative契約は明示scopeのContextに置き、全turnのSystem Promptへ重ねていた
変更案の例示は削除する。施設候補の採用とremove/moveの責務は既存`decisionSupport`形式で
区別する。Toolの公開集合・schema・モデル・temperature・検証境界は変更しない。

## 評価・残務

AQ: ホテルへ戻る希望に対し庭園を外す変更案（未確認の現在地から帰路は捏造しない）。
AR: connection-riskを根拠に既存区間へ検証済み代替Bを採用。AS: 保存済み環境Impactから既存屋内候補へ。
AT: 予約済みfixedを残して指定した庭園のみ外す。AU: model呼出し中のrevision変更を拒否。
合成fixtureは保存/Provider IOのみ差し替え、同じ本番Runtimeをscripted/live両方で使う。
AQ/ATは削除案なので既存のTTFI定義（新しい旅程を提示）に数えず、実際のProposalと保存不変を別途必須検査する。
既存A〜APの閾値/ケースは変更しない。Live成否・チェック結果はPRへ記録する。

#399の認証/公開writer・多選択操作のUI拡張・予約の変更取消は今回有効化しない。
Impact/Notification/Recheckの監視処理を変更せず、保存済みImpactを根拠とした無確認の自動mutationもない。
