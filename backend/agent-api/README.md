# TypeScript Agent API（Current）

Node.js BackendのApplication / Port / Adapter / Lambda entrypoint。
Domain計算は`modules/*/domain`、Provider非依存Context / Tool / Evidence契約は`modules/agent/runtime`に置く。
AWS SDK / Bedrock / Strandsの具体型はAdapterへ閉じ、BrowserやHTTP eventを内側へ持ち込まない。

| production入口 | 実行・保存の責務 |
| --- | --- |
| `agent-stream-lambda.ts` | 認証済み`/api/agent-stream` → `createProductionServerAgent` → Strands v2専用SDK loop / Server Tool / Conversation turn保存 |
| `personal-state-lambda.ts` | `/api/conversations/v1` / `/api/profile/v1` → owner-scoped Conversation / Profile V3 |
| `trip-api-lambda.ts` | `/api/trips/v1` → TripApplication / 採用preview・confirm / revision・CAS・receipt |
| `lambda.ts` | 残存`/api/agent`の独立read operation。汎用会話・feedback・traceは410。旧Agent Runtimeではない |

`server-agent-composition.ts`はServerAgentRuntimeRunnerを必須入力とし、productionはStrands v2を渡す。
旧Runtime / Prompt / Semantic pre-loop / Browser fallbackは撤去済み。画面はv2専用AssistantTurnViewへ投影する。
Conversation / Profile V3 / Trip V2はServer正本で、LocalStorage migration / dual-writeはない。

`npm run build`は各専用bundleを生成し、`infra/packaging`のmanifestがsource / handlerの正本。
代表ダイヤ・日付別経路入力はS3 Adapter、運行集計はDynamoDB Adapter / shared Domainへ委譲する。
宿泊は固定egress LambdaへIAM Invokeし、Provider credentialsをAgentへ渡さない。

## 確認

```bash
npm run build --workspace @raiquora/agent-api
npm run test --workspace @raiquora/agent-api
npm run lambda:check:built
```

全量とAcceptanceを同じrevisionで重複実行しない。[テストガイド](../../tests/README.md)を参照する。
Current契約は[Server Agent](../../docs/architecture/agent-runtime.md)、[認証](../../docs/architecture/authentication.md)、
[Server state](../../docs/architecture/server-state.md)、[Trip保存](../../docs/specs/trip-persistence.md)、
[Streaming](../../docs/architecture/agent-streaming.md)を参照する。
