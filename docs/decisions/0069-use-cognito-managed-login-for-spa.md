# ADR 0069: SPA認証をCognito Managed LoginとPKCEへ接続する

- ステータス: Accepted
- 日付: 2026-09-18
- 対象: #451第二段階。#484の検証境界を再利用する

## 決定

Cognito User PoolのEssentials、Managed Login v2、Cognito標準brandingをTerraformで管理する。
メールをusernameとし、メール検証・登録・再送・パスワード再設定はManaged Loginへ委ねる。
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
Basic保護とOACを維持する。CD実行・Terraform apply・本番切替は本作業では行わない。

## 保持・期限・ログアウト

Access Tokenは最大5分、タブ単位のsessionStorageへ表示名と絶対期限を保存する。
localStorageへtokenを書かない。再読込では期限内のsessionだけを復元し、期限切れ時は破棄する。
API用portはAccess Tokenだけを返す。期限切れ時はtokenを返さず、Managed Loginから再認証する。
サイレント更新・自動refresh・業務リクエストの自動再送は行わない。

Refresh TokenのCognito上の期限は最小の1時間とする。永続保存せず、そのdocumentのメモリだけに
保持してlogout時にbest effortでrevokeする。再読込すると失い、refreshにも再利用しないためrotationを
導入しない。ID TokenもsessionStorageに残さない。認証取引のstate/nonce/verifierはsessionStorageに
最大10分保持し、callbackで消費する。新規login/logout時は当clientの未完了取引を消去する。

logoutはまず当タブのsessionと未完了取引を消し、revoke成否にかかわらずCognito `/logout`へ遷移する。
遅着したtoken交換結果でsessionを復元しない。Cognito cookieの破棄とJWTの即時失効は別であり、
#484の署名検証だけでは発行済みAccess Tokenは最大5分有効。別タブのsessionも期限まで残り得る。
revoke対象のRefresh Tokenは再読込後には保持していない。この段階は全端末logoutを保証しない。

sessionStorageはXSSからtokenを守る仕組みではなく、同originの悪意あるscriptは読み取り可能である。
保持時間を短くし、token/claims/下位例外をログへ出さず、UIへはtextContentで表示する。
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

設定画面からログイン/新規登録とlogoutを提供する。未設定のローカル環境では認証不可と表示し、
Viewerは従来通り起動できる。取消/失敗/失効は固定文言で通知する。旅行プロフィール入力は認証条件にしない。
既存の端末内Profile/Tripをアカウント所有データとみなさず、アップロードしない。
owner cache破棄・個人API保護・全route配線は#451後続と#479/#480で行う。

## 検証と残件

ローカル試験は実oidc-client-tsと偽のHTTPS token応答を使い、PKCE、state/nonce、callback再利用、
scope不足、期限、安全な復帰、保存内容、logout、遅着responseを検査する。実Cognito稼働の証明ではない。
Terraform fmt/validate、Frontend auth test/typecheck/buildを行い、root全量とAgent Evalは実行しない。

適用前にEssentialsの課金条件を確認する。AWSでの日本語登録→メール検証/再送→login→callback、
パスワード再設定、logout、発行Access Tokenを#484へ渡す実環境確認は未実施とする。
API保護/直接API E2E/owner isolation/旧経路閉鎖は#451後続・#480/#461の責務である。

## 根拠

- [Cognito Managed Loginとfeature plan](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-managed-login.html)
- [Cognito料金](https://aws.amazon.com/cognito/pricing/)
- [Authorization endpoint / S256 / nonce](https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html)
- [Cognito logout endpoint](https://docs.aws.amazon.com/cognito/latest/developerguide/logout-endpoint.html)
- [oidc-client-ts](https://github.com/authts/oidc-client-ts)
- [ADR 0067](0067-establish-trusted-principal-boundary.md)
