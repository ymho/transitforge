# AWS dev環境

静的ビューワー AI API 混雑と遅延の収集基盤をTerraformで管理する

## 管理範囲

- 非公開S3とCloudFront
- Cloudflare AOPで保護する独自ドメイン配信
- AI駅員のLambda Function URLとBedrock権限
- 旅行提供者へ固定IPで接続するAI LambdaのNATインスタンスとElastic IP
- 混雑と遅延の収集Lambda EventBridge Scheduler S3 DynamoDB
- GitHub Actions用OIDCロール
- data-builderデプロイ用OIDCロール

data-builderのECS ECR 入力S3 Schedulerはdata-builderリポジトリが管理する

## 初期化

先に`../../bootstrap`でTerraform state用バケットを作成する

```bash
cp backend.hcl.example backend.hcl
cp terraform.tfvars.example terraform.tfvars
terraform init -backend-config=backend.hcl
terraform plan
```

`backend.hcl` `terraform.tfvars` 認証用ローカル変数はGitへ追加しない
秘密値はTerraformファイルやstateへ平文で保存しない

継続的なapplyはGitHub Actionsから行う
ローカルapplyは初期構築または障害復旧に限定する

## GitHub Environment

`dev` environmentへ次の値を設定する

| 種別 | 名前 | 用途 |
| --- | --- | --- |
| Variable | `AWS_DEPLOY_ROLE_ARN` | TransitForgeのデプロイロール |
| Variable | `TF_STATE_BUCKET` | 共有stateバケット |
| Variable | `DATA_BUILDER_GITHUB_OIDC_SUBJECT` | owner IDとrepository IDを含むdata-builderのimmutable subject |
| Variable | `CLOUDFLARE_FRONT_DOOR_ENABLED` | 独自ドメイン用CloudFrontの段階導入フラグ |
| Variable | `LEGACY_CLOUDFRONT_REDIRECT_ENABLED` | 既存CloudFront URLのリダイレクト切替フラグ |
| Secret | `BASIC_AUTH_CREDENTIALS_SHA256` | 開発環境の認証情報ハッシュ |
| Secret | `VITE_MAPBOX_ACCESS_TOKEN` | Mapbox公開トークン |

TransitForge自身のOIDC対象リポジトリはGitHub Actionsの`github.repository`から渡す
必須VariableはAWS認証より前に検証し 未設定ならapplyを開始しない

data-builder側へ渡す値はTerraform出力から取得し data-builderの`dev` environmentへ設定する

| 種別 | 名前 | 用途 |
| --- | --- | --- |
| Variable | `AWS_DEPLOY_ROLE_ARN` | data-builderのデプロイロール |
| Variable | `VIEWER_INPUT_BUCKET_NAME` | viewer inputの公開先 |
| Variable | `TF_STATE_BUCKET` | 共有stateバケット |

値そのものを文書 Issue PR ログへ記載しない

## 独自ドメインの初回導入

正規URLは`https://app.ohmyki.com`とする
Cloudflareのper-hostname Authenticated Origin PullsとCloudFront viewer mTLS required modeを組み合わせる
Basic認証はCloudFront Functionで維持し Cloudflare AccessやWorkerへ重複実装しない
独自ドメイン用Distributionは`Cloudflare-CDN-Cache-Control: no-store`を返し Cloudflareキャッシュで認証を迂回させない
CloudFront自身のキャッシュは維持する

切り替えは次の順で行う

1. 両方の段階導入フラグを`false`のままmainをデプロイ
2. `viewer_certificate_dns_validation_records`のCNAMEをCloudflare DNSへDNS onlyで追加
3. ACM証明書が`ISSUED`になるまで待つ
4. 専用CAと`app.ohmyki.com`用クライアント証明書を一時ディレクトリで生成
5. CA証明書だけを`mtls_trust_store_bucket_name`の`cloudflare-aop/ca.pem`へ配置
6. クライアント証明書と秘密鍵をCloudflareのper-hostname AOPへアップロードしてホスト名へ関連付け
7. 秘密鍵を含む一時ディレクトリを削除
8. `CLOUDFLARE_FRONT_DOOR_ENABLED=true`へ変更してworkflowを手動実行
9. `viewer_cloudfront_domain_name`を参照するproxied CNAME `app`をCloudflare DNSへ追加
10. CloudflareのSSLモードをFull strictへ変更して独自ドメインを確認
11. 認証なしで401 正しいBasic認証で200になることを確認
12. 成功応答の`CF-Cache-Status`が`HIT`にならないことを確認
13. CloudFrontの直接URLがクライアント証明書なしで失敗することを確認
14. `LEGACY_CLOUDFRONT_REDIRECT_ENABLED=true`へ変更してworkflowを手動実行
15. 既存CloudFront URLがパスとクエリを保ったまま正規URLへ308で移動することを確認

CA秘密鍵はクライアント証明書を署名した後に破棄する
証明書更新時は新しいCAを追加したbundleで先にCloudFront trust storeを更新し Cloudflare側を切り替えてから古いCAを外す
秘密鍵をGit Terraform state Issue PR CIログへ渡さない

ロールバック時は`LEGACY_CLOUDFRONT_REDIRECT_ENABLED=false`を先に適用する
その後Cloudflare DNSを戻し 最後に`CLOUDFLARE_FRONT_DOOR_ENABLED=false`を適用する

## CIとデプロイ

PRとmainへのpushで次を確認する

- TypeScriptとPythonのテスト
- 本番ビルド
- Terraform formatとvalidate

mainでは確認成功後にOIDCの一時認証情報でTerraformをapplyし 静的ファイルを配置する
`viewer-input/`と`api/`は各データ処理が管理するためWebアプリの同期対象から除外する

## 運用上の境界

- 4時を業務日付の切り替え時刻とする
- viewer inputの生成と公開を分離し 失敗時は直前の正常値を維持
- 外部データはブラウザから直接ポーリングしない
- 生履歴は非公開S3 分析索引はDynamoDBへ保存
- AIへ全履歴を渡さず Lambdaで決定的に集計
- 旅行提供者のAPIキーはバックエンドだけへ置き `ai_provider_egress_ip_address`だけを許可リストへ登録
- 現在地の座標をAWSへ送信しない
- 固定AWSアクセスキーを使わない

再集計コマンドはリポジトリルートの`tools/backfill_analytics.py --help`を参照
