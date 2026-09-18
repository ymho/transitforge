# ADR 0067: Cognito検証を共通trusted principal境界へ閉じる

- ステータス: Accepted
- 日付: 2026-09-18
- 対象: #451第一段階、利用先 #479、関連 #449/#476

## 決定

Backend `contracts/trusted-principal.ts` と `ports/access-token-verifier.ts` を認証の共通契約とする。
ApplicationはCognito claimsやHTTP eventを扱わず、検証結果の `TrustedPrincipal` を受ける。
`authenticatedApplication` がtoken検証→必要scopeの全件検査→業務呼出しの順序を固定する。
scope一覧と実行先はserver compositionで閉じ込め、requestのownerId/userId/email/principalをauthorityにしない。
この型はserver内部契約であり、JSONの型assertionや型適合は認証の代替ではない。

identityは検証済み `iss` と `sub` の組である。既存 `TripPrincipal.subject` への正規写像を
`identity-v1:` + lowercase hex SHA-256(UTF-8(JSON.stringify([iss, sub]))) とする。
区切りの曖昧さとTripの200文字上限を避け、poolを跨いだ同じsubを分離する。
これは既存subject値のエンコードであり、新owner table、別owner体系、account lookupは設けない。
Trip Repositoryの `OWNER#<subject>`、CAS、共有認可、内部workerのstorage由来subjectを変更しない。
Conversation/Profileも同じsubjectをそのまま使い、独自hashやsub単独キーを作らない。
メール変更やclient変更でownerは変わらず、pool/sub変更は別identityとなる。写像変更には明示migrationが必要。
既存の任意subjectの試験データを自動移行しない。実利用データの救済要否は#479で判断する。

## JWT検証と依存

AWSが推奨する `aws-jwt-verify` をBackend workspaceに追加する。暗号検証を自作しない。
設定済みUser Poolからissuer/JWKS URIを構成し、Access Tokenの署名、issuer、exp、nbf、
`token_use=access`、`client_id`を検査する。Cognito Access Tokenのclient期待値は`aud`ではなく
`client_id`で確認する。将来resource-bound audienceを導入する場合はその検査を同じAdapterへ追加する。
追加checkでRS256、必須exp、非空でboundedなsubを要求する。ID Tokenは拒否する。
必要scopeは共通Application境界で全件一致とする（ライブラリのscope配列はany-ofのため使わない）。

verifierはcompositionで一度作成して再利用する。標準SimpleJwksCacheのHTTPS取得、URI別cache、
未知kid時の再取得、同時fetchの共有、penalty boxによる連続再取得抑制を利用する。
JWTのjku等から取得先を選ばない。cache miss/取得失敗/未知鍵時は業務処理を呼ばない。
cache済みの既知鍵はネットワーク障害時も検証に利用できる。鍵cacheとJWTの有効期限は別である。
全検証エラーはclaims/token/causeを含まない `unauthenticated`、有効tokenのscope不足は `forbidden` にする。
JWT検証だけでは発行済みtokenの即時失効を保証しない。

## 境界と段階導入

公開HTTP/OAC/Gatewayへの配線、401/403応答への変換、token搬送と重複header拒否は次PRで行う。
既存Trip resolverへこのエラーを直接接続すると既存handlerの汎用エラー扱いになるため、
transport追加時は共通error mappingも同時に接続する。公開writerのgateは解除しない。
Cognito User Pool/App Client/scope Terraform、Managed Login/PKCE、失効・logout・cache方針も次段階とする。
本PRは本番の認証済み稼働や全API保護の完成を主張しない。
route分類と後続の接続規則は[認証境界](../architecture/authentication-boundary.md)を正とする。

## 根拠

- [AWS Cognito JWT検証](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-tokens-verifying-a-jwt.html)
- [aws-jwt-verifyの検証・JWKS cache仕様](https://github.com/awslabs/aws-jwt-verify)
- [ADR 0053: owner-scoped Trip保存](0053-gate-owner-scoped-trip-persistence.md)
- [ADR 0065: Trip共有認可](0065-authorize-trip-sharing-with-independent-resources.md)
