# 共通認証境界（#451）

導入時のmain `110d39a` のコード・infra定義を棚卸しした。実AWS設定を確認した記録ではない。
第一段階でprincipal/verifier/Application境界、第二段階でCognito TerraformとFrontend認証を導入する。
第三段階で既存の個人HTTP handlerへ共通認証を接続した。公開Lambdaのgateとwriter有効化は変更していない。
Frontendと設定出力は[ADR 0069](../decisions/0069-use-cognito-managed-login-for-spa.md)。
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

分類と接続状態を区別する。実行可能なallowlistは`backend/agent-api/src/adapters/api-route-policy.ts`、
認証付きの個人API組成は`personal-api-composition.ts`を正とする。分類を登録しただけではrouteを有効化しない。
初期のauthenticated userには共通custom scope `raiquora/user` を要求する。第二段階のTerraform resource serverがresource identifier `raiquora` / scope `user` を
正本として定義する。SPAと後続serverの設定はTerraform出力から生成する。利用料金制限・owner認可・ユーザー確認は別途必須で、このscopeで代替しない。
細分化が必要になった場合は台帳とserver compositionを同時更新する。

| 入口 / operation | 分類 | 現状 / 接続先 |
| --- | --- | --- |
| Home/説明、静的Viewer asset・認証設定、公開対象の`/viewer-input/*`・`/api/traffic/*` | public | 現行CloudFrontはBasic保護。公開解除は本PR対象外 |
| ログイン/callback/logout入口 | public | Frontend Managed Login/PKCE/callback/logoutを導入済み。実AWSの動作確認は未実施 |
| POST `/api/agent`: `bedrock_converse`（operation省略時も同じ） | authenticated user | 現行Agent handlerは利用者認証未接続。OAC/IAM/Basicは利用者principalではない |
| 同route: `representative_timetable_search`, `journey_search`, `daily_congestion_analysis`, `daily_congestion_peak`, `train_delay_analysis` | authenticated user | 動的Agent Tool。静的時刻表のpublic分類とは分離 |
| 同route: `travel_accommodation_search`, `weather_forecast_search`, `weather_grid_search`, `place_media_search`, `place_detail_research` | authenticated user | 外部Provider/modelへのアクセス前に共通境界を接続する |
| 同route: `web_search`, `web_page_read`, `travel_alert_search`, `ground_access_search`, `restaurant_search` | authenticated user | 同上 |
| 同route: `conversation_feedback`, `agent_trace` | authenticated user | /api/agent内のoperationのため今回は未接続。#462/#480でS3保存前に同じprincipalを接続する |
| POST `/api/trips/v1`: `create`, `mutate`, `get`, `list`, `archive`, `attach`, `detach`, `reference` | authenticated user | 共通認証→`TripApplication`→既存owner-scoped Repository。専用factoryで接続、公開501 gateは維持。未知operation/replaceは拒否 |
| POST `/api/trips/sharing/v1`: `create-grant`, `redeem`, `revoke-grant`, `manage`, `participant`, `accessible`, `reservation-facts` | authenticated user | 共通認証→`TripSharingApplication`の本人/参加者認可。公開501 gateは維持。grant secretだけで認証しない |
| POST `/api/trips/in-trip/v1`: read（operationなし） | authenticated user | 共通認証→`InTripContextApplication.read`のowner読取。公開501 gateは維持 |
| POST `/api/trips/notifications/v1`: `list`, `read` | authenticated user | 共通認証→`NotificationApplication`のowner読取/CAS既読。公開501 gateは維持 |
| Reservation: `create`, `get`, `list`, `update`, `cancel`, `link`, `unlink` | authenticated user | Applicationのみで対応handler/clientなし。新routeは作らず未接続。予約自体の実行APIではない |
| Checklist: `list`, `preview`, `add`, `update`, `confirm-suggestions` | authenticated user | Applicationのみで対応handler/clientなし。新routeは作らず未接続。確認authorityは別のtrusted host入力 |
| Conversation/Profile CRUD | authenticated user | #487で保存Applicationを導入済み。HTTP API/auth配線は本PR対象外。公開path/operations確定時に#479で追記 |
| trip-changed / rail-impact / trip-recheck / notification Lambda、EventBridge/SQS/Streams worker、内部event ingest | internal IAM-only | AWS event sourceと最小IAM、保存済みownerから解決。利用者JWTだけで起動不可 |
| 内部CLIのfeedback/trace読取・分析 | internal IAM-only | private S3のIAM読取。利用者向けread routeなし |

## Phase 3の実装境界

`adapters/http-api-auth.ts`はAuthorization/Bearer解析と安全な401/403応答だけを担当する。
`http-auth-composition.ts`の`createHttpPrincipalResolver`が同Adapterと#484の
`authenticatedApplication`を組み合わせ、必要scopeを全件検査してから`TrustedPrincipal`を返す。
JWT検証器は#484の`AccessTokenVerifier`だけであり、handlerごとに検証を再実装しない。

- HTTP API/Function URL v2のcomma結合header、REST/v1のmultiValueHeaders、header名の大文字小文字を扱う。
  2値以上、同名の大小文字別key、single/multi間の矛盾を401にする。同一値がv1の両mapに現れる標準の表現は
  一つのheaderとして扱う。未知の転送header・Basic・SigV4・body owner・requestContextの自己申告claimsを
  利用者認証として受け入れない。header値をエラーやログへ保持しない。
- tokenなし/不正/期限切れ/ID Tokenは401、有効Access Tokenのscope不足は403。
  応答は固定の`unauthenticated`/`forbidden`、no-store、401には`WWW-Authenticate: Bearer`を付ける。
  issuer/sub/scope内容/JWT/provider例外は返さない。認証は本文の処理とApplicationの呼出しより先に行う。
- `requirePersonalOperation`で既知のpath/version/operationとquery不使用を確認する。
  Tripの`mutate`がProposal適用/確認の既存入口であり、架空のupdate/confirm routeは増やさない。
  認証済みであっても既存の確認authority、CAS、idempotency、共有権限を迂回しない。
- `TrustedPrincipal.subject`をそのまま既存`TripPrincipal`へ渡す。ownerキー・Repository・receiptを増やさない。
  共有grantがないBからAへのget/mutate/archiveは不存在と同じ404。list/referenceは本人namespaceへ限定する。
  明示共有済みのeditor/viewerは既存`TripSharingApplication`で解決する。

`createPersonalApiHandler({ enabled, auth, tripTable, notificationTable })`は公開に配線しないopt-in factoryである。
`enabled !== true`では501のまま、trueでも`auth`はTerraformの`cognito_api_auth_config`出力から
trusted hostが渡す必要がある。verifierをhostごとに一度作成し、既存4handlerに同じresolverを注入する。
ルータは4つの完全一致pathだけを受け付け、未知pathは404で閉じる。Agentへのfallbackはない。
既存`lambda.ts`は編集しておらず、現在の公開経路の501 gateを維持する。
このfactoryの追加はproduction writer、IAM権限、Cognito/Bearer搬送を有効化したという意味ではない。

Reservation/ChecklistはHTTP handlerがなく、確認authorityの設計も別に必要なため今回公開しない。
feedback/traceは既存Agent handler内部にあり、/api/agentを変更しない責務分離を優先して#462/#480へ残す。
Conversation/Profileは#479へ残す。内部4workerは従来のEventBridge等のtrigger検査とIAMを維持し、
Bearerの存在から起動するrouteへ変更しない。

## Frontendの個人API境界

`adapters/http/authenticated-fetch.ts`を`auth-composition.ts`で#486のAuthSessionへ接続する。
`personal-api-fetch.ts`は4つの個人API clientのdefault transportだけを差し替え、global fetchやAgent clientは変更しない。
同origin・既知path・POST・query/hashなしに限定し、毎回`getAccessToken()`から得たAccess Tokenを
Authorization headerへ入れる。呼出元が指定したAuthorizationや任意外部URLは拒否し、redirect/error、
cache/no-store、referrer/no-referrerで送る。ID Tokenやprincipal/ownerを送らない。

401は`ApiAuthenticationError(unauthenticated)`に変換し、AuthSession.invalidateで保存tokenを破棄して失効表示へ移す。
403は`forbidden`として業務エラー/通信失敗と区別し、自動refresh/retryは行わない。
認証状態の変更ごとにsession世代を進め、通信をabortし、token取得中・応答本文/JSON取得中に世代が変われば
`session-changed`として破棄する。遅着した401が新しいsessionを失効させないよう世代を先に検査する。

Trip clientはrole cacheを世代で分離し、mutation IDを最初のsession世代へ結び付ける。
同一sessionでの応答消失再試行は既存のCAS/receiptへ任せ、別sessionから同じmutationを再送しない。
ID結合はdocument内に最大1,024件保持し、上限時は再読込/再確認を要求して無言evictionしない。
server workspace source/controllerもsession変更時にread view/role依存表示/表示中Proposal/保留mutationを破棄し、retryは読取から再開する。
非同期の確認処理中に利用者が変わった場合もmutation生成前に拒否する。
これは既存server workspaceの境界だけであり、#479のConversation/Profile保存設計やlegacyデータ移行を変更しない。

## Transportとの関係と残件

今回の標準Bearer Adapterは、Authorizationをそのまま受け取れるtrusted host用のコード経路である。
現在のCloudFront Basic認証/OAC signing always配下へそのまま公開できるとは主張しない。
AWS_IAM/OACをNONEへ変更せず、専用転送headerや一時的workaroundも追加していない。
#462の結果に合わせた搬送Adapterの交換・公開route配線、#480の段階enable/旧経路閉鎖、#461の実AWS認証E2Eを残す。
#451全体は未完了である。

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

Phase 3では実署名JWT/JWKS＋既存DynamoDB fixtureをHTTP handlerへ通し、Application呼出し前の401/403、
owner分離・偽装・同一404・CAS/receipt・未知operation拒否を確認する。Frontendは偽のAuthSession/networkで
Bearer付与、401/403、切替中の遅着応答、保留mutation/確認の破棄を確認する。実AWSを呼ぶ試験ではない。

```bash
npx vitest run backend/agent-api/src/adapters/http-api-auth.test.ts backend/agent-api/src/trip-handler-auth.test.ts backend/agent-api/src/personal-api-auth.test.ts
npx vitest run frontend/src/adapters/auth frontend/src/presentation/auth frontend/src/adapters/http/authenticated-fetch.test.ts frontend/src/adapters/http/server-trip-client.test.ts frontend/src/adapters/http/trip-sharing-client.test.ts frontend/src/adapters/http/notification-client.test.ts frontend/src/adapters/http/in-trip-context-client.test.ts frontend/src/usecases/trip-plan/server-trip-workspace-source.test.ts frontend/src/usecases/trip-plan/trip-workspace-controller.test.ts
npm run test --workspace @raiquora/agent-api -- --maxWorkers=2
npm run build --workspace @raiquora/agent-api
npm run build --workspace @raiquora/frontend
npm run architecture:check
```

header表現の根拠: [AWS Lambda proxy payload format 1.0/2.0](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html)。

root全量はCIへ委ねる。Agent Eval、live AWS/E2E、本番切替は本段階の検証に含めない。
