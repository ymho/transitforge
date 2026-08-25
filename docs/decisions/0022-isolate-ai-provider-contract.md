# ADR 0022: AI Provider固有形式をAdapterへ隔離する

- ステータス: Accepted
- 日付: 2026-08-25

## 背景

既存コンシェルジュはBedrock Converseの`toolUse` `toolResult` `stopReason`を直接扱う
後続のAgent Runtimeまでこの形式へ依存すると Provider変更 評価 固定応答テストが鉄道Toolの実装へ波及する

## 決定

`src/domain/agent/model-provider.ts`にProvider非依存のmessage request response metadata契約を置く

- contentは`text` `tool_call` `tool_result`に限定する
- stop reasonは`completed` `tool_calls` `max_tokens`に正規化する
- request ID model latency token usageを共通metadataへ格納する
- Bedrock形式との相互変換は`src/data/bedrock-model-provider.ts`だけで行う
- Tool定義は共通`AgentToolDescriptor`として渡し Lambda境界で許可名 件数 schemaを検証する
- 現在の一度だけの一時エラー再試行とレスポンスごとのrequest ID分離を維持する

既存コンシェルジュのloopは段階移行まで旧形式を維持する。新しいAgent Runtimeは
`BedrockAgentMessage`を参照せず`AgentModelProvider`だけへ依存する。

## 影響

- Agent Runtimeと固定応答テストをBedrock SDKの形式から分離できる
- Provider Adapterの変換コードとLambdaのTool schema検証が追加される
- 新旧loopが併存する期間は旧Bedrock契約を後方互換として維持する必要がある

## 確認

- text Tool call Tool resultが双方向に変換できること
- Provider metadataが並行request間で混ざらないこと
- 未許可または重複したTool定義をLambdaが拒否すること
- 既存コンシェルジュと再試行のテストが成功すること
