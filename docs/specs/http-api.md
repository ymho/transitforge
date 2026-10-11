# SPAのHTTP API契約

KAIHOはVite / TypeScriptのSPA。Browserは表示・入力・同一originへのHTTP接続を持ち、Conversation / Profile V3 / Trip V2の永続正本と認可はServerが所有する。
公開HTTP契約は[OpenAPI 3.1.1定義](../api/openapi.json)から参照する。既存のPOST + `operation`形式を記述し、URL・認証方式・業務挙動を変更しない。

## 対象の入口

| HTTP入口 | 内容 | 利用者の認証搬送 |
| --- | --- | --- |
| POST `/api/agent-stream` | 会話turn、progress / final / errorのSSE | `Authorization: Bearer <Access Token>` |
| POST `/api/conversations/v1` | 会話metadata、履歴、更新、削除 | 同上 |
| POST `/api/profile/v1` | Profile V3、revisionによるCAS | 同上 |
| POST `/api/trips/v1` | 相談開始、旅程、予定変更、候補採用・確認 | 同上 |
| POST `/api/trips/sharing/v1` | 共有grant・参加者・公式しおり | 同上 |
| POST `/api/agent` | 残存する独立検索・分析operation | `X-Raiquora-Access-Token: Bearer <Access Token>` |

全入口でCognito Access Tokenと`raiquora/user` scopeが必要。ID Token、body内のowner / principalは認可に使わない。
`/api/agent`のAuthorizationはCloudFront OACの署名が使うため、利用者tokenは専用headerで送る。
同一originを入口にし、BrowserへCloudFrontの内部API keyを渡さない。国制限・直接originの保護は[認証境界](../architecture/authentication.md)を参照する。

`operation`別のrequestは`oneOf`、responseは`anyOf`で記述する。同じpathが複数操作を受けるため、HTTPの`operationId`は入口ごとに一つ。
`x-operations`は受け付ける操作、`x-required-scopes`は必要scope、`x-max-body-bytes`はtransportの上限を示す。
Profileのgetは`profile: { profile, revision }`または`profile: null`、updateはトップレベルの`profile`と`revision`を返す。これらの既存の形も定義に含める。
旅程変更のrevision、mutationId、確認キー、owner権限、予約保護はServer側で検証する。複数field間の一致・期限・状態に依存する条件はJSON Schemaだけで代替しない。

## SSE

`/api/agent-stream`はPOST / fetchで受信する。requestに`conversationId`と`turnId`が必要。
HTTP bodyはSSEの文字列であり、JSON配列ではない。OpenAPIの`text/event-stream`はwireの文字列を表し、
`x-sse-events`が`event: agent`のJSON dataである`AgentEventFrame`と、`event: done`の`DoneEventFrame`を参照する。
`v: 1`、同一runId、1から増加するseq、final / errorの後のdoneを確認する。`: heartbeat`は接続維持用commentで、回答ではない。
HTTP 200開始後の失敗はerror eventで返る。200またはEOFだけで成功とせず、自動再接続もしない。

## 未公開の境界

通知とin-tripのpathは公開Trip hostに接続しておらず404。独立factoryの501 gateを公開済み機能と扱わない。
Reservation / Checklistは内部Application、EventBridge workerはIAM-only。これらをOpenAPIの`paths`へ追加しない。
Viewer入力・trafficの静的データ、auth-config、CognitoのOAuth endpointも本定義の対象外。
旧conversation / feedback / traceや未知の`/api/agent` operationは410であり、requestの選択肢に含めない。
API Gatewayなどhandlerより前の拒否は独自のbodyを返す場合がある。OpenAPIに定義した業務エラーbodyと混同しない。

## 更新と検証

`tools/openapi-contract.ts`は既存の公開Domain型を再利用したHTTP envelopeを所有する。
`tools/generate_openapi.mjs`がTypeScriptからschemaを生成し、transport-validatorの上限、認証、応答code、SSEを付加する。
派生物の`docs/api/openapi.json`は直接編集しない。型・公開操作・validator・handlerの変更と同じPRで再生成する。

```bash
npm run api:generate
npm run api:check
```

`api:check`はOpenAPI構文と参照、生成物の一致、公開allowlistとrequest操作の一致を確認する。
実parser、Profile handler、SSE handlerの合成入出力もschemaへ照合する。外部Provider / AWS / 有料モデルは呼ばない。
CIはこの検証を一回実行する。Swagger Editor、Swagger UI、OpenAPI対応のclient生成toolにはJSON定義を入力できる。
公開Swagger UIのhostingや自動生成clientへの切替は含めない。
