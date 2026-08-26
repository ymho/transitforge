# TypeScript Agent API

Node.jsで動作するAgent APIのBackend Application

Lambda eventとHTTP応答 operation dispatch Domain Tool接続を所有する
本番LambdaはこのworkspaceをbundleしたNode.js artifactを使用する

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
