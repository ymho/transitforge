# ADR 0024: Viewer Actionを同一Agentタスクの検証済みEntityへ限定する

- ステータス: Accepted（直接Viewer操作の公開はADR 0049で停止）
- 日付: 2026-08-25
- 関連: ADR 0049

## 背景

既存コンシェルジュは列車検索結果のservice UIDを一時集合へ保持してフォーカスを制限する
Multi-step Agent Runtimeで経路比較やEvidence表示を扱うには 同じ安全原則をActionごとの
個別実装ではなく共通境界として維持する必要がある

モデルへ任意のDOM操作やJavaScript実行を許すと Toolの検証結果とViewer表示の対応を保証できない

## 決定

Viewerへ反映できる操作を列挙型の`ViewerAgentAction`に限定する

- `focus_train`
- `highlight_route`
- `set_display_time`
- `compare_journeys`
- `show_evidence`
- 既存の`set_layer_visibility`

列車 経路 Evidenceを対象にするActionは Applicationが同じAgent実行のTool結果から
`ViewerActionTaskScope`へ登録したIDだけを許可する
ScopeとTraceの`executionId`が異なる場合も拒否する

構文検証 task scope検証 Port実行を`ViewerActionExecutor`へ集約する
Executorは提案 適用 拒否と安全な拒否理由をStructured Agent Traceへ残す
操作の効果は可逆な表示設定または表示だけに限定する

## 影響

- 未検証Entityや別taskの検索結果をViewerへ反映できない
- 表示実装はPortとして注入するためDomain層がDOMやMapboxへ依存しない
- 新しいAction追加時は型 parser Policy Port Trace testの更新が必要になる
- 現時点で表示Portがない新Actionは成功として扱わない

## 確認

- 未知Action 余分なfield 範囲外時刻をPort実行前に拒否すること
- 未検証または別taskの列車 経路 Evidenceを拒否すること
- Port失敗の内部情報をTraceへ残さないこと
- 直接Viewer操作の履歴契約は維持するが Agentへ公開しないこと
