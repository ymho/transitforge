# TypeScript Agent API

Agent APIをNode.jsへ段階移行するためのBackend Application

現時点ではLambda eventとHTTP応答 operation dispatchの契約互換基盤だけを持つ
本番Lambdaは引き続き`services/agent-api`のPython実装を使用し Issue #219の切替まで変更しない

## 境界

- `contracts`: Lambda event リクエスト HTTP応答のversioned contract
- `ports`: Bedrock S3 DynamoDBなど外部能力を抽象化する境界
- `usecases`: operation選択 入力検証 構造化ログ FeedbackとTraceのbounded record
- `adapters`: S3など外部技術をPortへ変換する実装
- `handler.ts`: AWS eventをApplicationへ渡す薄い入口

AWS SDKの型は`contracts` `ports` `usecases` `handler.ts`へ持ち込まない
今後追加するAdapterがSDK固有の入力と出力をPortへ変換する

Feedback v1 v2とAgent TraceはPython版と同じschema S3 key prefix サイズ上限を維持する
保存ログには会話本文や保存失敗の例外内容を含めない

Bedrock会話は`ConversationModel` Portを通し provider固有の`system` `toolConfig`
`inferenceConfig`と応答検証をAdapter内へ閉じる。Applicationへ返すmetadataはmodel ID
latency token usageだけに限定する

## 確認

```bash
npm run build --workspace @raiquora/agent-api
npm run test --workspace @raiquora/agent-api
```
