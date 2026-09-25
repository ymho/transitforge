# ADR 0087: 普段の好み設定をcompactな自動保存UIにする

- ステータス: Accepted
- 日付: 2026-09-25
- 関連: #658、#659、Epic #631、ADR 0086

## 背景

旧旅行プロフィールは全項目を大きなfieldsetで常時表示し、画面下にstickyな保存バーを置いていた。普段の人数・予算・移動上限など各旅行で決める条件まで常設フォームに含み、保存成功時の全再描画はIME、フォーカス、開閉状態、スクロールを失う可能性があった。

## 決定

設定画面ではProfileを「いつもの好み」と表示し、出発地・移動、興味、ペース・移動の好み、宿泊・食事、避けたいことの5カテゴリを独立した`details`で開閉する。閉じたsummaryは編集中draftから短い現在値を導出し、別の保存modelを持たない。開閉は保存を発生させず、複数カテゴリを同時に開ける。

保存button、sticky bar、discard、通常の離脱blockを撤去する。select、checkbox、choiceは変更時に即時保存し、text/textareaはIME変換中を除外して確定後400msで保存する。アプリ内遷移は保留変更を前倒しし、Browser終了時だけに依存しない。

`ProfileUiController`は更新を直列化し、保存中の新しいdraftを最後の値へcoalesceする。各requestは最新の保存済みrevisionを`expectedRevision`に使う。古い成功応答でUIを再描画せず、入力、focus、details、scrollを保持する。失敗・競合は成功表示にせず、最新draftを保持して明示的に再試行できる。account clearは保留timerと表示draftを破棄し、遅着responseを別sessionへ適用しない。削除は進行中のautosave完了後に既存の明示確認を通す。

AI利用checkboxは既存値を保持し、既定ONにしない。旧v2の非表示fieldはdraftから削除せずround-tripする。Profile変更はTrip/予約を更新しない。

## 結果

- 手動保存操作なしでServer Profileが正本になる。
- 連続編集とIMEで新しい値を失わない。
- 設定全体を見渡しながら必要なカテゴリだけ編集できる。
- 旧Profileデータ保持と新AI適用範囲を分離できる。
