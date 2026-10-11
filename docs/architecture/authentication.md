# 共通認証境界

Cognito Managed Login / PKCE、secretなしSPA client、Access Tokenと`raiquora/user`を使用する。
Homeの静的入口以外はログイン後だけ起動し、未認証では地図・運行データ・個人APIを読まない。
自己登録は無効。Access / ID Tokenは5分、Refresh Tokenと新規ログインの絶対期限は12時間。
タブ単位sessionStorageへ保持し、refresh / reloadで絶対期限を延長しない。

Gateway authorizerとBackendの同じCognito verifierがissuer / client / token_use / 期限 / scopeを検査する。
TrustedPrincipal.subjectをownerへ写し、bodyのownerId / userId / email / claimsを認可根拠にしない。
401 / 403はApplication・Repository・model / Toolの実行前に拒否する。

## 公開経路とgate

| 経路 / 能力 | Currentの接続 |
| --- | --- |
| POST `/api/agent-stream` | 認証済みRegional REST → Strands v2専用Server Agent。旧Runtime / Browser fallbackなし |
| POST `/api/conversations/v1` / `/api/profile/v1` | 専用personal-state Lambda → Conversation / Profile V3 Application → owner-scoped DynamoDB |
| POST `/api/trips/v1` | 専用Trip API Lambda → TripApplication。start / branch consultation、CRUD・CAS mutation・参照・候補/Trip/itemのpreview / confirmを既存operationで提供 |
| `/api/trips/sharing/v1` | 認証済みTrip API hostがParticipant / Grantの共有操作を公開する |
| `/api/trips/in-trip/v1` / `/api/trips/notifications/v1` | 独立factoryの公開501 gateを維持。Trip API hostはこれらのpathを公開せず404 |
| Reservation / Checklist | 内部Applicationのみ。公開handler / clientなし。実予約・取消APIではない |
| POST `/api/agent`の汎用conversation / feedback / trace / 未知operation | 410。独立read callerのFunction URL / OAC resourceと分離する |
| 同routeの残存read operation | Cognito Access Token / scope必須。Browser transportが`X-Raiquora-Access-Token`を設定し、OAC signingとの競合を避ける |
| EventBridge等のworker / private S3読取 | IAM-only。利用者JWTで起動・全件照会しない |

実行可能なoperationは`backend/agent-api/src/adapters/api-route-policy.ts`と各handlerが正本。
認証対応の分類と、Terraformが公開するrouteを混同しない。Trip writerは有効だが全個人API factoryのgate解除ではない。
[Trip保存](../specs/trip-persistence.md)、[Server state](server-state.md)、[旧ingress](authentication.md)を参照する。

## Browser境界と一次根拠

`adapters/http/authenticated-fetch.ts`と`personal-api-fetch.ts`は同origin・既知path・POSTへ限定する。
個人API / streamはAuthorization、残存OAC Agent operationだけ専用headerを使う。
ID Token / principalを送らず、呼出元によるtoken header・外部URLを拒否する。
401時の更新はsession契約の範囲で1回だけ。account世代が変われば古いtoken待ち・応答・mutationを破棄する。
Conversation / Profile / TripのLocalStorage writer・import・fallbackは撤去済み。

一次根拠: `infra/terraform/environments/dev/cognito.tf` / `agent-stream.tf`、
`backend/agent-api/src/adapters/cognito-access-token-verifier.ts` / `http-api-auth.ts`、
`trip-api-composition.ts` / `personal-state-api-composition.ts`と隣接test、`frontend/src/adapters/auth/cognito-session.ts`と隣接test。
ローカル署名JWT・Dynamo fixture・合成ブラウザ試験は実Cognito / AWSの連続利用試験と別である。

## 初回起動とログイン期限

旅程一覧Sourceは認証状態とsession versionの両方をsnapshotとして保持し、変化したときだけ消去・通知する。
同じ未認証状態の読取では通知せず、同期subscriberの再読取も再帰させない。
Composition Rootは認証初期化、Viewerのdynamic import、非同期起動を順にawaitする。
entry自体はtop-level awaitで止めない。ViteがViewerからentryの共有exportを参照すると、
entryのawaitとdynamic importが互いのmodule評価完了を待つためである。起動Promiseの失敗はComposition内で処理する。
途中失敗では非表示のProduct shellとは別の起動状態欄へ固定文言と再読み込みボタンを出す。
未認証の個人API・地図・運行データgateは維持する。

新規ログインの絶対期限とCognito Refresh Token期限は12時間。Access/ID Tokenは最大5分のままとし、
refreshやreloadで絶対期限を延長しない。旧8時間sessionは元の期限を保持する。token保存は引き続きタブ単位のsessionStorageである。
CDはAWSのApp Clientから期限・単位を読み戻し、12時間と5分の組合せを確認する。

`node tools/verify_viewer_startup.mjs`はbuild済みViewerをChromiumの1440px/390pxで起動する。
ハッシュなし・保護route・reload・pageshow・8時間経過後のrefresh・12時間失効・logout・import失敗後の復旧を確認する。
CIでは既存のChromium導入とbuildを再利用する。認証/個人APIはsyntheticであり、実Cognitoでの12時間連続利用の証明ではない。

## 独立read入口 `/api/agent`

旧汎用conversation、feedback、trace、未指定・未知operationは410。独立したread operationだけを`backend/agent-api/src/legacy-agent-ingress.ts`のallowlistで受け付ける。HTTP入力からモデルのmessages、Tool定義、modelClass、認証principalを注入できない。

Function URLはAWS_IAM、CloudFront OACの署名とSourceArn制限を維持する。Cognitoが必要なreadは`X-Raiquora-Access-Token`を共通verifierで検証する。公開weather readの分類は`api-route-policy.ts`が所有し、公開readから個人State・有料モデルへ接続しない。URLやOAC resourceの存在を旧Agent Runtimeの存続と解釈しない。
