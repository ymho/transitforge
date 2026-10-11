# Trip Readinessと旅行前準備

## 派生Readiness

`modules/trip/domain/trip-readiness.ts`の`projectTripReadiness`が、同じTrip ID/revisionの
新しく評価したFeasibilityと完全なReservationFact/Checklist readを受け取る。revision不一致は拒否する。
Applicationは実際の現在Tripから再評価し、これは保存やreadyの認定証ではない。

- tripId / tripRevision / evaluatedAt / planning issues / booking issues / preparation summary。
- Planningは空旅程・未選択の移動/宿・hard条件・未確認仮定等、既存Feasibility codeを使う。
- Bookingはreservation系codeと宿泊予約の時刻精度を投影する。5状態をそのまま表示する。
  `undefined`はread unavailable、`[]`は完全readで記録なし。どちらも未予約/予約済みとは断定しない。
- `unrecordedItemIds`は予約の記録coverage未確認であり、すべてのitemに予約が必要という判断ではない。
- #438のnon-blocking unknown（宿の時刻・営業未取得・取得済み移動の時刻精度等）はそのまま残す。
  `blocksReady`は全Feasibilityの既存policyから計算し、準備数・モデル回答・表示の切詰めに依存しない。
- 現在のplanning/lifecycleは自動変更しない。ready＋open、infeasible＋準備完了の両方があり得る。
  「readyだから営業確認済み」と表示しない。種類を混ぜた総合％を作らない。

## Checklist契約と操作

`TripChecklistItem`はUUID id/tripId、schemaVersion=1、revision（初期0）、category/title/status/source、
archived、任意のrelatedItineraryItemId/relatedReservationId/dueDateを持つ。Trip JSONへ追加しない。
カテゴリ8種、status=open/done/not-needed、source=user/model/system-suggestion。タイトル最大200文字、
予約IDはopaque UUID、item ID最大200文字、dueDateは既存LocalDate。未知field/制御文字/不正日付は拒否。
source=system-suggestionは契約として有効だが、自動生成writerはない。

- add: ユーザー操作はsource=user/open/revision0で作る。同exact keyは追加しない。
- update: existing ID + baseRevision。rename/category/status/dueDate/archive/linkを明示更新。
  省略は保持、optional fieldのnullは明示解除。id/tripId/sourceを編集できない。
- done / reopen / not-neededは同じupdate。削除相当はrecoverableなarchiveで、一覧から履歴を確認できる。
- 新しい関連IDは現在のownerのTrip/ReservationFactで検証する。既存のdangling参照はstatus更新を妨げず、
  warningを出し、unlink/relink/archiveは利用者が明示操作する。Tripをarchiveしても準備記録は残る。

## 提案と重複防止

`propose_preparation_checklist`は現在Tripと完全read済みChecklistを使うadd-only能力。
category/titleと任意の関連ID/期限を最大12件受け取り、未保存の`ChecklistProposal`を返す。
プレビュー → 明示確認 → `ChecklistApplication.execute(..., {confirmed:true})` → Repository。
confirmationはtrusted hostの引数で、LLM/HTTP bodyが権限を自己申告できない。
Tool選択はモデル。準備を提案するための別モデル呼出しや固定weather ruleを作らない。

exact keyはcategoryとNFKC→trim→連続空白を1文字化→ASCII case foldしたtitle。
「傘」と「雨具」は別。既存user/done/not-needed/archiveは全て照合する。提案はそれらを上書きしない。
保存直前にも完全なreadへ同じ重複判定を行う。モデルにIDやdoneを生成させず、確認後にApplicationがIDを割り当てる。
既存項目の編集・完了は内部Applicationの明示操作。自然言語からの既存項目更新Proposalは未実装で自動完了しない。

## Persistence・失敗時

`ChecklistRepository` / `DynamoDbChecklistRepository`、内部組成`createInternalChecklistApplication`。

- PK `OWNER#trustedSubject`、SK `CHECKLIST#tripId#itemId`。JSONはstorageVersion=1のenvelope。
- `CHECKLIST_STATE#tripId`のcollection versionはPersistence競合検知だけに使う。
  更新はcollection CASと個別item CASを同一TransactWriteで実施。Trip/Reservation revisionは増やさない。
- owner/Trip prefixのconsistent Queryを全ページ読む。最大1000項目、反復/越境cursor・破損・過大データは
  安全側のエラー。Query前後のcollection versionも照合して混在readを拒否する。
- Proposal最大12件を原子的に保存。CAS競合はconflict、通信/応答消失はunavailable。
  blind retryはせず再取得する。再確認時の同じ追加提案はexact keyで既存状態を保つ。
  staleなupdateはbaseRevision不一致で拒否する（暗黙upsertしない）。
- active TripをApplicationで確認する。Trip/Reservation変更とChecklistは別transactionで、
  確認後に対象が変わる競合はdangling warningとして扱い、cascadeしない。
- 同じ暗号化/PITR/削除保護tableと既存IAMのGet/Put/Queryを利用。Scan、新table、新routeは追加しない。
  Checklistの公開handler / clientはない。Tripの公開writerとは別の内部resourceである。
