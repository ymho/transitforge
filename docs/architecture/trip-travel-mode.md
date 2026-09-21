# Trip旅行モード（#460）

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
[Trip詳細の4タブ](trip-detail-tabs.md)と同じ実経路照合を使う。AI相談は生の要求を既存の対象固定
Server Conversationへ送り、選択itemだけをbounded UI focusとして渡す。変更案は既存#397の
Proposal・保護範囲・明示確認・CASを通り、画面独自の再計画器を持たない。

ChromiumによるPC/スマホの最終視覚確認は実行環境にブラウザがないため保留し、ローカル環境で行う。
