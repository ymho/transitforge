# Trip Readinessと旅行前準備（#392）

正本は#382/#415、ADR 0052/0057。#402の成立性、#398の予約、#390のWorkspaceを拡張する。

## 現状 → 今回 → 後続

| 領域 | Before | #392 | 残す責務 |
| --- | --- | --- | --- |
| 計画の不足 | Feasibility/仮定が別表示 | 同じissue codeをPlanningへ投影 | 監視由来のTripImpact #393以降 |
| 予約 | 独立Reservationと通常Fact | Booking issues、5状態、未取得/記録なしを分離 | 実予約APIは対象外 |
| 準備 | 正本なし | 独立Checklist resource、確認型Proposal | Hazard #401、通知 #395、共有 #399 |
| 保存 | owner-scoped Trip/Reservation | 同じtable、別namespace、独自CAS | 公開認証レビュー・writer rollout |
| Agent | Trip/候補/現実事実を分離 | bounded Readinessと準備提案能力 | 固定フローは導入しない |

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
既存項目の編集・完了は今回UIの明示操作。自然言語からの既存項目更新Proposalは未実装で自動完了しない。

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
  PUBLIC writer OFF、LocalStorage/legacy writer変更なし、dual-writeなし。

## Workspace / Agent

`trip-readiness-view.ts`は「次に決めること」を派生表示し、予定へのfocusを提供する。checkboxは付けない。
`trip-checklist-view.ts`は「旅行前の準備」をカテゴリ別件数、checkbox/不要/archive、編集form、関連先、追加案の確認で表示する。
writer未供給/未取得は編集不可。取得失敗時は古い準備状態を表示し続けない。
`checklist-workspace-controller.ts`は一時preview/送信中状態だけをsession別に保持し、別Tripへ適用しない。
server sourceは明示供給したreader/writerだけを使い、通信失敗後も再取得して不明を保持する。

`tripReadinessContext`はplanning/booking各16件、準備24件、関連IDの配列をboundedにする。
元の件数・truncation・全体blocking判定を維持し、private bookingReference/raw Provider/自由な予約メモは渡さない。
既存Contextの圧縮経路でもallowlistを保持する。未掲載=問題なし、selected=bookedとは解釈しない。
準備案は`checklist_proposal`という可視成果物で、候補/Itineraryを生成したTTFC/TTFIには算入しない。

## migration / gate / 手動確認

旧TripPlanに準備正本がないためmigrationは不要。bookingURLやlegacy回答からdone/bookedを生成しない。
同じTrip V2型/converter/API writer gateを変更しない。認証された内部hostの操作のみ保存できる。

`npm run dev` → `http://localhost:5173/?trip-workspace-preview=1` でsyntheticな準備リストを確認できる。
チェック/不要/編集/link/archive/追加を試す。旅程・チャットの切替後も一時previewを維持する。
このDEV hostはメモリだけで、リロード保存や実予約を意味しない。公開アプリのwriterを有効にしたという説明はしない。

## 検証とAC対応

| AC | 検証 |
| --- | --- |
| Planningの既存issue/policy・revision | Domain readiness tests、既存Feasibility/ready全回帰、AF/AG |
| 5予約状態・未取得・selected非推測 | readiness tests、通常Reservation projection、AG |
| Checklist validation/編集/独自revision | Domain checklist/edit tests、Application CRUD |
| 重複・user/done/not-needed/archive保持 | Domain正規化test、Application再確認/同時追加/応答消失、AH |
| owner/CAS/失敗/参照切れ/gate | SDK contract fake + Application/infra negative tests、Frontend source再読込test |
| 2領域・操作・プレビュー・focus | DOM/Workspace controller tests、DEV preview |
| Agent bounds/privacy/提案のみ | Tool/context tests、production RuntimeのAF〜AH |
| 既存機能維持 | 全test/build/architecture/workspace/Smoke/Full/infra/diff checks |

AFはready＋booked＋未完了準備、AGはselected Stay＋予約必須/unknown、AHは完了SIMの繰返し提案。
既存A〜AEのthresholdを変更しない。AF〜AHは準備/予約相談で新旅程生成を求めないためTTFC/TTFIはnull。
scripted IOで境界を評価し、実モデルの会話品質を証明したとはしない。
Liveは既存「AWS認証期限切れで未実施」を維持。認証rolloutや外部API再設定は本Issue外。
