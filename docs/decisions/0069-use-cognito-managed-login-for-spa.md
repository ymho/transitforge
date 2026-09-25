# ADR 0069: SPA認証をCognito Managed LoginとPKCEへ接続する

- ステータス: Accepted
- 日付: 2026-09-18
- 対象: #451第二段階。#484の検証境界を再利用する

## 決定

Cognito User PoolのEssentials、Managed Login v2、Cognito標準brandingをTerraformで管理する。
メールをusernameとし、ログインとパスワード再設定はManaged Loginへ委ねる。
2026-09-25以降は自己登録を無効化し、新しい利用者は管理者だけが作成する。Managed Loginに新規登録リンクを
表示せず、公開されているApp Client IDを使った`SignUp` API要求も拒否する。既存利用者のログインは維持する。
公開SPA App Clientはsecretなし、Authorization Code + PKCE S256だけを使用する。
Resource Serverが`raiquora/user`を定義し、`openid email`と合わせて要求する。

`oidc-client-ts`をFrontendへ追加する。stateの乱数生成と一度限りの消費、PKCE生成・交換、
nonce照合を自作しない。Adapterはnonceを明示し、取引期限10分、callback origin/path、
重複code/state、ID Tokenのissuer/audience/期限、応答のscope/期限も確認する。
ID Tokenは固定HTTPS token endpointからの応答を表示に使うだけで永続保存しない。
このブラウザ表示状態はtrusted principalではない。APIは#484でAccess Tokenの署名とclaimsを検証する。

## 設定の正本

`infra/terraform/environments/dev/cognito.tf`のresource参照から以下を生成する。

- `cognito_frontend_config`: issuer、clientId、loginOrigin、scopes、callbackUrls、logoutUrls。
  CDが`dist/auth-config.json`へ出力し、SPAが同一originから取得する。secretやtokenは含めない。
- `cognito_api_auth_config`: userPoolId、clientId、requiredScopes。
  後続のserver compositionが`createCognitoAccessTokenVerifier`と`authenticatedApplication`へ渡す。

Frontendの環境変数にpool/client/scopeを別途書かない。Backendも同じ出力から設定を受ける。
本PRではBackend runtime/composition、HTTP bearer搬送、route保護へ接続しない。

callbackは配信済み`/index.html`、logoutは`/`とする。CloudFrontのSPA fallback追加を不要にする。
正規originは既存`viewer_domain_name`を使用し、localhost:5173の許可はdev変数で明示的に有効化する。
OACを維持する。CloudFront Basic認証は2026-09-24に撤去し、Home以外の全機能をFrontendのCognito認証gate、
業務APIをBackendのCognito verifierで保護する。CD実行・Terraform applyは別のデプロイ手順で行う。

## 保持・期限・ログアウト

Access/ID Tokenは最大5分のまま、Refresh TokenのCognito上の期限は8時間とする。タブ単位の
sessionStorageへschema version、issuer、client ID、scope、発行時刻、Access Token期限、ログイン開始から
最大8時間の絶対期限、Access/Refresh Token、表示名を保存する。localStorageへtokenを書かず、ID Tokenも
保存しない。再読込では設定との完全一致と期限を検証し、不正または絶対期限切れのsessionを破棄する。

Access Tokenの失効30秒前にはrefresh grantを行う。同時要求は単一flightへ集約し、rotationされたRefresh
Tokenは同じ絶対期限で置換する。401だけは強制refresh後に同一要求を1回再送し、2度目の401でsessionを
失効させる。403や業務エラーはrefreshしない。refresh失敗をループせず再ログインへ戻す。認証取引の
state/nonce/verifierはsessionStorageに
最大10分保持し、callbackで消費する。新規login/logout時は当clientの未完了取引を消去する。

logoutはまず当タブのsessionと未完了取引を消し、revoke成否にかかわらずCognito `/logout`へ遷移する。
遅着したtoken交換結果でsessionを復元しない。Cognito cookieの破棄とJWTの即時失効は別であり、
#484の署名検証だけでは発行済みAccess Tokenは最大5分有効。別タブのsessionも期限まで残り得る。
logout世代より遅く完了したrefreshはsessionを復元しない。この段階は全端末logoutを保証しない。

sessionStorageはXSSからtokenを守る仕組みではなく、同originの悪意あるscriptは読み取り可能である。
絶対期限を8時間に限定し、token/claims/下位例外をログへ出さず、UIへはtextContentで表示する。
stateとPKCEでlogin CSRF/code横取りを抑止し、nonceで応答との対応を確認する。
BFFやIdentity Poolは追加しない。

## 元画面への復帰

return-toはローカルの認証stateに保持する既知のdocument path（`/`または`/index.html`）だけとする。
query/hash・任意URL・相談文・Trip情報・共有secretは往復させない。会話選択やworkspaceの復元は
既存の端末内Repositoryへ委ね、認証独自の会話コピーを作らない。
callback成功・失敗ともURLを最初に消去し、その後に設定取得/token交換/Viewer起動を行う。
ページのreferrer policyはoriginとし、初期asset要求でもcodeをRefererに載せない。
Mapbox等のorigin制限付き公開tokenとの互換性を保ち、認証設定の取得自体はno-referrerとする。
認証情報をURLログへ残さない運用は後続の公開経路監査にも含める。

アカウントアイコンと各機能入口からログインへ進み、設定画面からlogoutを提供する。
未認証ではHomeだけを表示し、相談、旅程、プロフィール、通知、設定、地図、列車、運行情報を起動しない。
直リンクもHomeへ戻し、地図と運行データを読み込まない。取消/失敗/失効は固定文言で通知する。
既存の端末内Profile/Tripをアカウント所有データとみなさず、アップロードしない。
owner cache破棄・個人API保護・全route配線は#451後続と#479/#480で行う。

## 検証と残件

ローカル試験は実oidc-client-tsと偽のHTTPS token応答を使い、PKCE、state/nonce、callback再利用、
scope不足、期限、安全な復帰、保存内容、logout、遅着responseを検査する。実Cognito稼働の証明ではない。
Terraform fmt/validate、Frontend auth test/typecheck/buildを行い、root全量とAgent Evalは実行しない。

適用前にEssentialsの課金条件を確認する。AWSでの管理者作成→初回login→callback、パスワード再設定、
logout、発行Access Tokenを#484へ渡す実環境確認は未実施とする。
API保護/直接API E2E/owner isolation/旧経路閉鎖は#451後続・#480/#461の責務である。

## 根拠

- [Cognito Managed Loginとfeature plan](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-managed-login.html)
- [Cognito料金](https://aws.amazon.com/cognito/pricing/)
- [Authorization endpoint / S256 / nonce](https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html)
- [Cognito logout endpoint](https://docs.aws.amazon.com/cognito/latest/developerguide/logout-endpoint.html)
- [oidc-client-ts](https://github.com/authts/oidc-client-ts)
- [ADR 0067](0067-establish-trusted-principal-boundary.md)
