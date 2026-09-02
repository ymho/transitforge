# ADR 0049: AIによる直接Viewer操作を一旦停止する

- ステータス: Accepted
- 日付: 2026-09-02
- 関連: ADR 0024 0026 0044 0045 Issue #332

## 背景

初期のAI運行観察員は 自然文から表示時刻 列車フォーカス 可視化レイヤーを変更し
運行中の列車を観察する役割を持っていた。その後プロダクトの中心は 旅行プロフィールと
検証済みEvidenceを使って候補を提案する旅行コンシェルジュへ移ったが、旧来の直接操作Toolが
本番の能力一覧と開発用フォールバックに残っていた。

直近の会話フィードバックで確認した反復質問は`ask_follow_up`の判断によるもので、直接操作Toolは
実行されていなかった。したがって直接操作の停止を反復質問の修正とは扱わない。一方で現在の
役割に不要な能力を公開し続けると Tool選択肢と責務が増え、検索結果の提示とViewer制御の境界も
曖昧になる。

## 決定

- `set_display_time` `focus_train` `set_layer_visibility`を本番Agent Tool Registryと
  Agent API allowlistから外す
- `search_direct_routes`と既存経路の再検索は 検索結果を返すだけにして列車を自動選択しない
- 開発用ローカルフォールバックも表示時刻 列車選択 レイヤーを変更しない
- 時刻を含む自然文はViewer時計の変更ではなく検索条件として扱う
- 手動の表示時刻 列車選択 可視化レイヤー操作はViewer UIへ残す
- `search_weather_forecast`は読み取り専用の旅行Evidence Toolとして残し 地図表現を変更しない
- 検索結果に結び付く`highlight_route` `compare_journeys` `show_evidence`と、Viewer Actionの
  構文 task scope Port Traceの安全境界は維持する
- 直接操作の列挙型契約は既存Traceと互換性検証のため残すが Agentから到達不能にする

これは業務ケースごとのTool隠蔽ではなく、提供しない能力をRegistryから取り除く判断であり
ADR 0045の能力単位の公開方針を維持する。ADR 0024と0026の安全境界は結果表示へ引き続き適用し、
直接Viewer操作を公開する部分だけを本ADRで置き換える。

## 影響

- 旅行相談と列車検索は画面状態を副作用として変更しない
- 利用者が見ていた表示時刻 列車 レイヤーをAgent応答が不意に変えない
- 検索結果は従来どおり構造化し タブ 路線色付き区間 比較 Evidenceとして表示できる
- 手動操作と検索結果表示の責務が分かれ、会話Toolの候補が3件減る
- 将来直接操作を戻す場合は 利用者価値と会話評価を確認した新ADRで公開範囲を決める

## 確認

- 本番能力一覧とAgent API allowlistに3つの直接操作Toolがないこと
- 経路検索と既存経路の再検索で列車フォーカスが発生しないこと
- 開発用フォールバックが時刻 列車 レイヤーを変更しないこと
- 読み取り専用の列車 経路 天気検索と手動Viewer UIが維持されること
- `npm test`
- `npm run build`
- `npm run architecture:check`
- `npm run workspace:check`
- `npm run eval:agent:smoke`
