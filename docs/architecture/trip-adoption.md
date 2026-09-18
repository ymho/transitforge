# Tripの採用意思と表示分類（#450）

表示順は予定の各timeZoneにおける暦日順。同日ではday精度、次に判明したinstant順、最後にTrip IDで安定化する。
UTC文字列とlocal dateを混ぜず、dayの出発時刻は捏造しない。異なるtimezoneのdate-only予定間の厳密な出発順を保証するものではない。

## Before / Afterと所有境界

既存のTripにoptional `adoption: { confirmedAt, needsReconfirmation?: true }`だけを追加する。
新しいplanStatusは作らない。未登録の旧V2/legacyは採用意思未確認として読み、readyから確認日時を捏造しない。
schemaVersion 2の互換拡張であり、既存converter/writer/保存キーの切替やbackfillはない。

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
公開writer/認証gateは閉じたまま、#451/#454が認証済み製品導線を配線する。
終了/中止は既存lifecycle ProposalとconfirmedLifecycleを使用し、Reservationを変更しない。
terminalの復活は禁止のまま。replanからadoptionを書き換えられない。

採用後のitem追加/削除/順序/場所/時刻/交通、party、起終点/日付/期間/移動条件変更は確認日時を保持して再確認フラグを立てる。
タイトルだけの変更、budgetや好み、別resourceの費用メモは採用意思を維持する。
重要変更の後も意図の記録は消さず、明示再確認でフラグを外す。withdrawだけが採用を撤回する。

## 共有selector

Home/一覧/詳細は`classifyTrips(trips, realClock)`を使う。simulatorの時計を渡さない。
terminalは終了/中止、予定がpastなら未採用でも過去の予定、未採用/再確認/日程不明は計画中。
採用済みcurrentは旅行中の「予定」表示、upcomingで最も早いものを次の旅、残りを予定ありとする。
fixed/windowはoffset付きinstant、dayは暦日精度の安定順（同精度内の同日はIDでtie break）。
dayから出発時刻を生成しない。checkoutは既存の排他境界。端末timezoneで状態を変えない。

## 後続

#453はこのselectorをread sourceへ接続する。#454は認証済み複数Trip一覧・保存操作、#459/#460は詳細/旅行モードを担当する。
本PRで公開保存・旅行実績自動推定・予約取消・新しいRepositoryは追加しない。
