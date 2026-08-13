# AWS dev環境

静的ビューワー AI API 混雑と遅延の収集基盤をTerraformで管理する

## 管理範囲

- 非公開S3とCloudFront
- AI駅員のLambda Function URLとBedrock権限
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
| Secret | `BASIC_AUTH_CREDENTIALS_SHA256` | 開発環境の認証情報ハッシュ |
| Secret | `VITE_MAPBOX_ACCESS_TOKEN` | Mapbox公開トークン |

data-builder側へ渡す値はTerraform出力から取得し data-builderの`dev` environmentへ設定する

| 種別 | 名前 | 用途 |
| --- | --- | --- |
| Variable | `AWS_DEPLOY_ROLE_ARN` | data-builderのデプロイロール |
| Variable | `VIEWER_INPUT_BUCKET_NAME` | viewer inputの公開先 |
| Variable | `TF_STATE_BUCKET` | 共有stateバケット |

値そのものを文書 Issue PR ログへ記載しない

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
- 現在地の座標をAWSへ送信しない
- 固定AWSアクセスキーを使わない

再集計コマンドはリポジトリルートの`tools/backfill_analytics.py --help`を参照
