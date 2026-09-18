# 共通認証境界（#451）

導入時のmain `110d39a` のコード・infra定義を棚卸しした。実AWS設定を確認した記録ではない。
第一段階でprincipal/verifier/Application境界、第二段階でCognito TerraformとFrontend認証を導入する。
公開handlerへの接続とwriter有効化は未実施。Frontendと設定出力は[ADR 0069](../decisions/0069-use-cognito-managed-login-for-spa.md)。
判断とsubjectの永続エンコードは[ADR 0067](../decisions/0067-establish-trusted-principal-boundary.md)。

## #479からの利用

- `backend/agent-api/src/contracts/trusted-principal.ts`: provider非依存の検証結果。
  `identity.issuer/subject` は検証済みiss/sub、`subject` は既存Tripと共通の永続ownerキー。
- `ports/access-token-verifier.ts`: token→principalのport。requestから実装を選ばせない。
- `adapters/cognito-access-token-verifier.ts`: trusted compositionのpool/client設定で一度生成する。
  JWKS cache注入はserver/test infrastructureだけのseamでありHTTPへ公開しない。
- `usecases/authenticated-application.ts`: 必須scopeを検査してからApplicationを呼ぶ。
  principalはinputとは別引数。認証失敗時はRepository/Bedrock/Toolを呼ばない。

```ts
// authConfig is the trusted Terraform cognito_api_auth_config output, never request input.
const verifier = createCognitoAccessTokenVerifier(authConfig);
const executeTrip = authenticatedApplication(verifier, authConfig.requiredScopes,
  (principal, command: unknown) => tripApplication.execute(principal, command));
// trusted transport extracts ONE token; request body is never a principal.
await executeTrip(accessToken, command);
```

Conversation/Profileも同じwrapperからprincipalを受け、Repositoryへ`principal.subject`を渡せる。
Cognito UIやTrip公開writerの完成待ちは不要。テストはport fakeを注入可能だが、本番で固定ownerを使わない。
既存Tripのowner/共有認可はその後も必須であり、scopeを持つだけでは他利用者のTripへアクセスできない。

## route / operation inventory

分類は**導入先の要求ポリシー**であり、現在の利用者認証の実装済み一覧ではない。
初期のauthenticated userには共通custom scope `raiquora/user` を要求する。第二段階のTerraform resource serverがresource identifier `raiquora` / scope `user` を
正本として定義する。SPAと後続serverの設定はTerraform出力から生成する。利用料金制限・owner認可・ユーザー確認は別途必須で、このscopeで代替しない。
細分化が必要になった場合は台帳とserver compositionを同時更新する。

| 入口 / operation | 分類 | 現状 / 接続先 |
| --- | --- | --- |
| Home/説明、静的Viewer asset、公開対象の`/viewer-input/*` | public | 現行CloudFrontはBasic保護。公開解除は本PR対象外 |
| ログイン/callback/logout入口 | public | Frontend Managed Login/PKCE/callback/logoutを導入済み。実AWSの動作確認は未実施 |
| POST `/api/agent`: `bedrock_converse`（operation省略時も同じ） | authenticated user | 現行Agent handlerは利用者認証未接続。OAC/IAM/Basicは利用者principalではない |
| 同route: `representative_timetable_search`, `journey_search`, `daily_congestion_analysis`, `daily_congestion_peak`, `train_delay_analysis` | authenticated user | 動的Agent Tool。静的時刻表のpublic分類とは分離 |
| 同route: `travel_accommodation_search`, `weather_forecast_search`, `weather_grid_search`, `place_media_search`, `place_detail_research` | authenticated user | 外部Provider/modelへのアクセス前に共通境界を接続する |
| 同route: `web_search`, `web_page_read`, `travel_alert_search`, `ground_access_search`, `restaurant_search` | authenticated user | 同上 |
| 同route: `conversation_feedback`, `agent_trace` | authenticated user | S3保存前に同じprincipal。本文のownerを採用しない。後続でserver-only traceへ移す場合は台帳も更新 |
| POST `/api/trips/v1`: `create`, `mutate`, `get`, `list`, `archive`, `attach`, `detach`, `reference` | authenticated user | `TripApplication`、公開501 gateを維持。replaceは廃止済み |
| POST `/api/trips/sharing/v1`: `create-grant`, `redeem`, `revoke-grant`, `manage`, `participant`, `accessible`, `reservation-facts` | authenticated user | `TripSharingApplication`、501 gate。grant secretだけで認証しない |
| POST `/api/trips/in-trip/v1`: read（operationなし） | authenticated user | `InTripContextApplication.read`、501 gate |
| POST `/api/trips/notifications/v1`: `list`, `read` | authenticated user | `NotificationApplication`、501 gate |
| Reservation: `create`, `get`, `list`, `update`, `cancel`, `link`, `unlink` | authenticated user | Applicationのみ、公開HTTP routeなし。予約自体の実行APIではない |
| Checklist: `list`, `preview`, `add`, `update`, `confirm-suggestions` | authenticated user | Applicationのみ、公開HTTP routeなし。確認authorityは別のtrusted host入力 |
| Conversation/Profile CRUD | authenticated user | #479で実装予定。公開path/operations確定時に追記 |
| trip-changed / rail-impact / trip-recheck / notification Lambda、EventBridge/SQS/Streams worker、内部event ingest | internal IAM-only | AWS event sourceと最小IAM、保存済みownerから解決。利用者JWTだけで起動不可 |
| 内部CLIのfeedback/trace読取・分析 | internal IAM-only | private S3のIAM読取。利用者向けread routeなし |

## 後続transportの共通規則

- route/operationのallowlistをこの台帳から明示して共通境界へ接続する。未知route/operationを
  public扱いやmodel-call fallbackへ流さない。現行Agentの未知operation fallbackも配線時に閉じる。
- user tokenは `AccessTokenVerifier` だけで検証する。単なるheader存在、claims JSON、
  Gateway風eventの自己申告をtrusted principalへ変換しない。IAM-onlyはJWTで代替しない。
- `AuthenticationError` の `unauthenticated`→401、`forbidden`→403を共通transportで変換し、
  応答をno-storeにする。token、claims、生Profile、会話全文、下位例外をログへ出さない。
- Function URLのAWS_IAMとOAC signing alwaysを維持する。Bearer転送headerの外部入力を
  削除/上書きし、重複/矛盾を拒否する搬送契約は次PR。転送されたJWTも必ず検証する。
- Gateway採用時も同じpool/client/scope/subject写像を使う。API種別ごとのAuthorizer差分は
  transportに閉じる。ID Tokenや別clientを受け入れる第二の認証設計を作らない。

## 検証

`cognito-access-token-verifier.test.ts` は実行時生成のRSA鍵とローカルJWKS fetcherを使い、
実ライブラリで署名/期限/issuer/client/token種別/scope/鍵rotationを検証する。
`adapters/cognito-token.fixture.ts`の`cognitoTokenFixture()`/`token()`は#479の境界試験でも再利用できる。
既存DynamoDB command fixtureとTripApplicationへ通してsubject接続、別利用者のnot-found、
forged owner/user/email拒否も検証する。秘密鍵やAccess Tokenはファイルへ保存しない。

```bash
npx vitest run backend/agent-api/src/adapters/cognito-access-token-verifier.test.ts
npm run test --workspace @raiquora/agent-api
npm run build --workspace @raiquora/agent-api
```

root全量はCIへ委ねる。Agent Eval、live AWS/E2E、本番切替は本段階の検証に含めない。
