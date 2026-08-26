# ADR 0033: AgentのオーケストレーションをApplicationへ置く

- ステータス: Superseded by ADR 0038
- 日付: 2026-08-25

## 背景

Agent Runtime Tool Registry Evidence Trace EvaluationとViewer Actionが`src/domain`にあり
鉄道や旅行の決定論的な規則とAI実行のユースケースが同じ階層へ混在していた。
旧Viewer AgentはBedrock固有DTOとPresentationの列車タイトルにも依存していた。

## 決定

- Agent Runtime Tool Adapter Evidence Trace Evaluationを`src/application/agent`へ置く
- Viewer Actionの契約 Policy Executorを`src/application/viewer`へ置く
- 移行中のローカルViewer Agentを`src/application/viewer-agent`へ置く
- Bedrock固有の旧Viewer Agentを`src/adapters/bedrock`へ隔離する
- 列車 経路 遅延などの計算は引き続き`src/domain`が所有する
- UI表示形式は依存注入し ApplicationからPresentationへ直接依存しない

## 影響

- Agentの変更と鉄道規則の変更を異なる境界でレビューできる
- MCPとBedrockは同じApplication Tool Registryを利用する
- 旧Bedrock経路は機能単位の移行が終わるまでAdapterとして残る
- `main.ts`はApplicationとAdapterを接続するComposition Rootとして扱う

本番実行の一本化後の配置と境界は[ADR 0038](0038-use-one-production-agent-runtime.md)を正本とする。

## 確認

- `npm run architecture:check`
- `npm test`
- `npm run eval:agent:smoke`
- `npm run build`
