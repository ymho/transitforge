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
Current契約は[Server Agent](../../docs/architecture/server-agent-cutover.md)、[認証](../../docs/architecture/authentication-boundary.md)、
[Server state](../../docs/architecture/server-state-persistence.md)、[Trip保存](../../docs/architecture/trip-server-persistence.md)、
[Streaming](../../docs/architecture/agent-streaming-production.md)を参照する。

## Historical: Wave 2B / #462 PoC

> 以下は移行前の実装・検証記録。2026-10-05のmain `32d51f6`で履歴として分離した。
> 旧runner・型・未接続の記述とコマンドは現行の組成手順ではない。

## Server Agent Application（Wave 2B）

`createServerAgent({ model, weather, additionalTools? })`は`runAgentTurn({ principal,
userRequest, conversationId?, tripId?, uiContext?: { itemId? } })`を返す。
HTTP eventを受けず、結果は`Promise<AgentRuntimeResult>`でEvidence/Claim/Traceを含む。
`model`へ既存`BedrockConversationModel`を渡すとTool往復を同一process内で完結する。
weatherは既存WeatherForecastProvider、追加Toolはdescriptor/operation/Evidence mapperを登録する。
固定IP Providerはoperation Portの実装側へ閉じる。

呼出元が認証済み`TrustedPrincipal`を渡す。fake principalでoffline実行できるが、principalの形の
検査だけでは認証にならない。会話/Tripの参照を永続状態から解決する処理は#479、
公開transportは#462/#480へ残す。uiContextはboundedな参照であり、未取得のTrip状態や認可根拠にしない。
今回は公開route・production compositionを切り替えない。
共有coreの配置と移行先は[ADR 0068](../../docs/decisions/0068-place-agent-runtime-in-server-application.md)を参照する。

```bash
npx vitest run modules/agent/runtime backend/agent-api/src/usecases/agent backend/agent-api/src/server-agent-composition.test.ts
npm run typecheck --workspace @raiquora/agent-api
```

`npm run test --workspace @raiquora/agent-api`は共有Runtime coreの隣接testも実行する。Frontend workspaceの全量testはこの範囲を除外し、root CIで重複実行しない。

## Streaming transport PoC（#462）

`agent-stream-poc-lambda.ts`は独立したdefault-off検証入口で、production package/routeへは未接続。
既存Server AgentをApplication event sinkで観測し、認証後にprogress/final/errorをSSEへ変換する。
[検証記録](../../docs/experiments/agent-stream-462.md)と[ADR 0070](../../docs/decisions/0070-select-regional-rest-agent-streaming.md)に再現手順・測定値・未実施のAWS gateを記録する。
