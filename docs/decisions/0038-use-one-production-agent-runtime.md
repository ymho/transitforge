# ADR 0038: 本番Agent実行を共通Runtimeへ一本化する

> 2026-09-19 / #481 Batch 1: production Browser組成とBedrock conversation bridgeはretired。
> 現在の実行所有はServer Agentであり、以下のBrowser Adapter記述はHistoricalである。

> 2026-09-18 / [ADR 0068](0068-place-agent-runtime-in-server-application.md): production Runtimeの最終所有をBackendへ変更する。Browser組成は#480までの一時経路で、coreは共有単一実装とする。Evidence/Groundingとbounded loopは維持する。

> 2026-09-18 / [Wave 2A #477](https://github.com/ymho/transitforge/issues/477)（親方針 #476）: Viewer ActionおよびLocalViewerAgent/DEV fallbackの部分はretired。本番MultiStepAgentRuntimeとBedrock Adapterの組成は引き続き有効で、Server移行は後続Issueで行う。
> 以下は決定当時の記録として保持する。

- ステータス: Accepted
- 日付: 2026-08-25
- 置換: ADR 0033の移行中Viewer Agent配置

## 背景

共通Multi-step Agent Runtimeの導入後もBedrock Adapter内に独自のTool loopが残り
本番会話だけEvidence Trace Viewer Action Policyを迂回していた。ローカル開発用Agentと
決定的なViewer入力解釈も`application/viewer-agent`へ混在していた。

## 決定

- 本番のモデル実行は`MultiStepAgentRuntime`だけを入口とする
- Bedrock AdapterはProvider DTO変換 Tool Adapterの組成 構造化UI応答への変換だけを担う
- 既存の列車 経路 運行分析 旅行Toolは`AgentToolRegistry`と`AgentToolExecutor`を通す
- Toolが提案するViewer操作も`ToolViewerActionRegistry`で明示Actionへ変換し
  同一実行のEvidence scopeと`ViewerActionExecutor`で検証する
- Structured Traceは会話Sessionと関連request IDへ紐付けて既存のprivate保存境界へ送る
- ローカル開発用Agentは`application/agent` 決定的なViewer入力解釈は`application/viewer`へ置く
- 旧独自loopと`application/viewer-agent`ディレクトリを削除する

## 影響

- 本番AgentのTool call Evidence Viewer Action latency model tokenを一つのTraceで追跡できる
- Tool結果から確定できる経路 旅行 追加質問はモデル自由文で再構成せず既存の構造化UI契約を維持する
- Bedrock固有形式は`adapters/bedrock/viewer-agent-runtime.ts`の外へ漏れない
- 開発時のAPI障害だけローカルAgentへfallbackするが本番のAgent実行経路には含めない

## 確認

- `npm run architecture:check`
- `npm test`
- `npm run eval:agent:smoke`
- `npm run build`
