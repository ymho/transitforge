# TypeScript Agent API

Node.jsで動作するAgent APIのBackend Application

Lambda eventとHTTP応答 operation dispatch Domain Tool接続を所有する
本番LambdaはこのworkspaceをbundleしたNode.js artifactを使用する

Trip APIはAgent operationとは独立した `trip-api-v1` 契約を持つ。#388の内部Repositoryは
trusted server principalを全操作に要求する。現在のdeploymentには利用者認証Adapterがないため、
public Trip routeを追加せず、LambdaのTrip handlerも既定で501を返す。
内部worker組成は `createInternalTripApplication(table)`、通常UIのwriter/CASは#389以降。
詳細は[Trip server保存基盤](../../docs/architecture/trip-server-persistence.md)を参照する。

## 境界

- `contracts`: Lambda event リクエスト HTTP応答のversioned contract
- `ports`: Bedrock S3 DynamoDBなど外部能力を抽象化する境界
- `usecases`: operation選択 入力検証 構造化ログ FeedbackとTraceのbounded record
- `adapters`: S3など外部技術をPortへ変換する実装
- `handler.ts`: AWS eventをApplicationへ渡す薄い入口

AWS SDKの型は`contracts` `ports` `usecases` `handler.ts`へ持ち込まない

Feedback v1 v2とAgent Traceは既存schema S3 key prefix サイズ上限を維持する
保存ログには会話本文や保存失敗の例外内容を含めない

Bedrock会話は`ConversationModel` Portを通し provider固有の`system` `toolConfig`
`inferenceConfig`と応答検証をAdapter内へ閉じる。Applicationへ返すmetadataはmodel ID
latency token usageだけに限定する

代表ダイヤはS3 AdapterでgzipとETag cacheを扱い 検索Usecaseは最大5件に制限する
混雑と遅延はDynamoDB AdapterがAttributeValueを正規化し `@raiquora/operation`が
4時境界の業務日付 未観測値 日次 時間別 列車別の集計規則を所有する

経路探索は`@raiquora/journey`の直通indexと多目的探索を正本とし S3 Adapterは
日付別gzip indexと当日snapshotの取得だけを担う。Agentは経路や乗換を再計算しない

## 確認

```bash
npm run build --workspace @raiquora/agent-api
npm run test --workspace @raiquora/agent-api
npm run lambda:check --workspace @raiquora/agent-api
```

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
