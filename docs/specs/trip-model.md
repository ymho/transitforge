# Trip V2: 正本契約

Trip V2はproduction Server正本。独立UUID / schemaVersion 2または3 / revision / TripRequest / items / planningState / lifecycleStateを
`modules/trip/domain`のvalidatorで検証し、認証済み`/api/trips/v1`のTripApplication / Repositoryで保存する。
Conversation metadataのtripIdは参照だけで、会話削除はTripを削除しない。Profile V3は任意3項目の別resource。
Browserに旧TripPlan reader / writer / fallback / migrationはない。

| 境界 | Currentの契約 / 詳細 |
| --- | --- |
| 条件・仮定・人数 | Trip.request。受理済み会話条件とProfile hintを区別する。[TripRequest](trip-conditions.md) / [Profile V3](profile.md) |
| 計画・旅行状態 | Tripのplanning / lifecycleを正本にし、固定質問順を作らない。[状態](trip-model.md) |
| 日時と予定 | transport / stay / activity、fixed / window / day / relative / unscheduled、calendar binding。[Schedule](trip-schedule.md) / [相対時間・構造](trip-schedule.md) |
| 採用 | verified候補と採用Snapshotを分離。railは予定値と取得できた種別・列車名・行先、宿は保持許諾済み最小施設参照。[候補選択](agent-publication.md) |
| 保存 | create / applyMutation / archive、owner-scoped CAS / mutation receipt / outbox。同一再送を重複保存しない。[Server保存](trip-persistence.md) / [更新](trip-persistence.md) |
| 表示 | 専用旅程一覧・日別タイムライン。削除はarchive。集約準備パネルは撤去し、予約保護・成立性評価は保持。[workspace](trip-workspace.md) |
| 公開範囲 | Trip writerは有効。公開共有 / 未公開in-trip・通知のgate、Reservation / Checklistの未公開は別境界。[認証台帳](../architecture/authentication.md) |

一次根拠: `modules/trip/domain/trip.ts` / `trip-request.ts` / `itinerary-schedule.ts`と隣接test、
`backend/agent-api/src/ports/trip-repository.ts` / `usecases/trip-application.ts`、`infra/terraform/environments/dev/agent-stream.tf`。
現行型の詳細はコードを正とし、各機能仕様へ進む。

## Tripの計画・旅行状態

Trip.planningState / lifecycleStateがServer Trip V2の正本。段階の固定順やTool routerを作らない。
planningはinspiration / candidate_discovery / candidate_selection / itinerary_draft / itinerary_refinement / ready、
lifecycleはpre_trip / in_trip / completed / cancelled。readyは変更後Tripの成立性とCASを検証し、未知を成立と扱わない。
時計だけでcompletedにせず、採用予定を訪問実績と混同しない。
一次根拠: `modules/trip/domain/trip-state.ts` / `trip-state.test.ts`、`backend/agent-api/src/usecases/trip-application.ts`。
旧Browser producer・状態復元・migrationはない。

保存・認可は[Trip保存](trip-persistence.md)、型契約は[Trip lifecycle](trip-model.md)を参照する。

## Tripの採用意思と表示分類

表示順は予定の各timeZoneにおける暦日順。同日ではday精度、次に判明したinstant順、最後にTrip IDで安定化する。
UTC文字列とlocal dateを混ぜず、dayの出発時刻は捏造しない。異なるtimezoneのdate-only予定間の厳密な出発順を保証するものではない。

## 採用意思の所有境界

Tripのoptional `adoption: { confirmedAt, needsReconfirmation?: true }`が採用意思を保持する。
新しいplanStatusは作らない。未登録の旧V2/legacyは採用意思未確認として読み、readyから確認日時を捏造しない。
採用日時を自動backfillせず、未登録の旅程を確定済みと扱わない。

| 正本/評価 | 意味 | 採用との関係 |
| --- | --- | --- |
| Tripの保存 | 曖昧な案を保持 | 日程/採用不要 |
| adoption | 利用者がこの旅程で行くと明示した | 費用/予約/成立性の証拠ではない |
| planningState ready | 既存Feasibility policyで認定 | 採用操作では変更しない |
| lifecycleState | 既存の開始/終了/中止状態 | 採用/画面閲覧/時計だけで更新しない |
| temporal assessment | 注入した実時計上の予定位置 | 訪問/乗車/終了実績ではない |

## 明示操作と更新

`TripPatch.adoption`はconfirm/withdraw。採用には1件以上の日程付きitemが必要で、dayにはzoneが必要。
windowは曖昧な時刻幅のまま採用できる。unscheduled/希望月のみ/空Tripは仮保存可能だが確定不可。
移動未確認やAI予測費用は取得済みfactへ変えず、既存ready拒否条件を一切緩和しない。

hostは画面で確認したexact Proposalの確認keyを、モデル/HTTP bodyと別にApplicationへ渡す。
既存baseRevision/mutationId/CAS/receiptを使用。確認日時はhost実時計。createへの採用metadata注入は拒否。
採用のpreview / confirmは認証済みTrip APIから行う。
終了/中止は既存lifecycle ProposalとconfirmedLifecycleを使用し、Reservationを変更しない。
terminalの復活は禁止のまま。replanからadoptionを書き換えられない。

#754でowner向けTrip APIに`preview-trip-adoption` / `confirm-trip-adoption`を追加した。confirm/withdrawとも、`tripId`、`baseTripRevision`、`mutationId`、actionへ結び付けた確認keyを使う。previewと同じ明示操作だけをtrusted Application hostがDomainの確認authorityへ変換し、generic mutation bodyからauthorityを注入することはできない。既存mutation receiptで再送を冪等にし、古いrevisionは再previewを要求する。

Trip画面は同じ正本を「この旅程で行く」「変更後の旅程を再確認」「計画へ戻す」として表示する。この操作は成立性の認定、予約、当時の天候・価格の現在値化を行わない。

採用後のitem追加/削除/順序/場所/時刻/交通、party、起終点/日付/期間/移動条件変更は確認日時を保持して再確認フラグを立てる。
タイトルだけの変更、budgetや好み、別resourceの費用メモは採用意思を維持する。
重要変更の後も意図の記録は消さず、明示再確認でフラグを外す。withdrawだけが採用を撤回する。

## 共有selector

Home/一覧/詳細は`classifyTrips(trips, realClock)`を使う。simulatorの時計を渡さない。
terminalは終了/中止、予定がpastなら未採用でも過去の予定、未採用/再確認/日程不明は計画中。
採用済みcurrentは旅行中の「予定」表示、upcomingで最も早いものを次の旅、残りを予定ありとする。
fixed/windowはoffset付きinstant、dayは暦日精度の安定順（同精度内の同日はIDでtie break）。
dayから出発時刻を生成しない。checkoutは既存の排他境界。端末timezoneで状態を変えない。
