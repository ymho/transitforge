# ADR 0096: Agent実行ループをStrandsへ移しApplication契約を外側に保つ

- ステータス: Accepted
- 日付: 2026-09-26
- 関連: #631、#676、#681

## 背景

Epic #631で会話意味論、Effective Intent、owner/revision、A/B commit、Evidence、Trip/Profile/Reservationの正本境界をApplicationへ確立した。一方、現行`MultiStepAgentRuntime`はmodel/tool loopだけでなく、Provider出力補正、repair、planning/photo/progress guard、finalization、重複Tool制御まで所有している。

#676の実モデル検証では、決定論的Domain/Applicationテストが通る一方で、Provider出力を自前契約へ合わせるdebugが継続した。これは製品固有の正しさではなく、汎用Agent loopを自作していることによる保守コストである。

## 判断

Agent v2のmodel/tool loopに`@strands-agents/sdk`を採用する。

StrandsはBackend Adapter層に閉じる。StrandsのAgent、Session、Memory、Tool metadataを正本・authorityとして扱わない。各turnでfresh Agentを生成し、Conversationの継続状態は既存Server stateからApplicationが再構成する。

初期移行ではread-only ToolだけをStrandsへ公開する。Tool callbackは次の順で既存境界を通す。

```text
Strands tool use
  → validateToolIntentUse(Effective Intent)
  → AgentToolExecutor
  → AgentToolRegistry.parseInput / Domain Tool
  → ToolEvidenceRegistry
  → Strands tool result
```

proposal/writeはStrandsから直接実行しない。既存Applicationの確認、binding、CAS、mutation receiptを接続する後続段階でのみ公開する。

Strandsのdefault retry、SessionManager、MemoryManagerには依存しない。初期Engineではretryを無効化し、turn/token/cancellationのbounded controlだけを利用する。

## 維持する契約

- Cognito principalとowner分離
- beginTurn、turn idempotency、A/B commit
- Semantic IntentのApplication検証とreducer
- Effective Intentとrevision/fingerprint
- Trip/Profile/Reservationの正本とCAS
- Tool固有input parserと意味precondition
- Evidence mapper、applicability、freshness
- public presentation、SSE、history/replay

これらはStrands SDKのstateやmodel出力で置換しない。

## 互換性

V1の内部クラス、Prompt repair、planning guard、fallbackの挙動は互換要件にしない。互換要件は#631の受入シナリオとDomain/Application invariantである。

初期移行はproduction defaultをV1に維持し、V2をopt-inで組成した。一般公開の完成判定はcritical security gate、Smoke/Full、production-shaped multi-turnで行い、最終的にV1 Runtimeと移行adapterを削除する。

### 2026-09-26 開発用実環境の前倒し切替

#706で、利用者が未対応機能・品質低下を許容する開発用切替を承認した。現在のdev実サービスはCDの明示設定でV2を選ぶ。これは一般公開の品質合格や#703/#681の完了ではない。
旧Semantic IntentはOFF、Agentの業務Toolはread-onlyを維持し、V1への自動fallbackは追加しない。V1は緊急時の明示的な復帰用に一時保持する。
設定の読み戻し、既知の未完了、復帰と実装順は[Agent v2開発用実環境切替](../architecture/agent-v2-development-cutover.md)を参照する。

## 影響

- Agent loopのライフサイクルとTool dispatchはStrandsに委譲できる。
- Vendor SDK依存はBackend Adapterに限定する。
- Strandsのconversation/session memoryは利用しないため、既存DynamoDB stateとの二重正本を作らない。
- Toolの権限・意味整合性・Evidenceは従来どおりApplication側で検証する。
- SDK更新はlockfileとAgent v2の受入テストで管理する。

## 対象外

AgentCore Runtime/Harness、multi-agent、Memory/RAG基盤の追加、Domain Toolの再実装はこの判断に含めない。

関連: #631 #676 #681 #706
