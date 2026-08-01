# TransitForge dev environment

非公開S3バケットとCloudFront OACを作成し、現在の静的ビューワーを配信する。
EventBridge SchedulerとLambdaは収録事業者の列車混雑情報を1分間隔で取得し、
最新値と分析用の時系列アーカイブをS3へ保存し、日別検索用の毎分サマリーを
DynamoDBへ保存する。AI運行観察員はCloudFrontからのみ
呼び出せるLambda Function URLを通じてAmazon Bedrock Nova Liteを使用する。
列車遅延は別のSchedulerとLambdaが、重複排除した26個の走行位置JSONを1分間隔で
各1回だけ取得し、最新値、S3履歴、DynamoDB毎分サマリーを保存する。
静的viewer-inputはEventBridge Schedulerが毎日3:00（JST）にECS Fargateの
`transitforge-data-builder`を起動して全件再生成し、Web用S3へ公開する。

## 初期化

先に `../../bootstrap` をapplyし、出力されたstateバケット名を設定する。
また、CloudFrontはBasic認証を必須とする。平文のパスワードをファイルや
Terraform stateへ保存せず、`ユーザー名:パスワード` のSHA-256だけを設定する。

パスワードをチャットやシェル履歴へ残さないよう、次のコマンドで対話入力する。

```bash
read -rsp "TransitForge password: " TRANSITFORGE_PASSWORD
echo
printf 'basic_auth_username = "trf"\n' > basic-auth.auto.tfvars
printf 'basic_auth_credentials_sha256 = "%s"\n' \
  "$(printf 'trf:%s' "$TRANSITFORGE_PASSWORD" | sha256sum | cut -d ' ' -f 1)" \
  >> basic-auth.auto.tfvars
unset TRANSITFORGE_PASSWORD
chmod 600 basic-auth.auto.tfvars
```

`basic-auth.auto.tfvars` はGit管理対象外である。ユーザー名を変更する場合は、
ハッシュ生成側の `trf:` も同じ値へ変更する。

```bash
cp backend.hcl.example backend.hcl
cp terraform.tfvars.example terraform.tfvars
terraform init -backend-config=backend.hcl
terraform plan
terraform apply
```

## アプリケーション配置

リポジトリルートでNode.js 22を使用してビルドする。Mapbox公開トークンは
ビルド時だけ環境から渡し、Terraformやstateへ保存しない。

```bash
nvm use
npm run build
```

環境ディレクトリで出力値を取得し、リポジトリルートへ戻って配置する。

```bash
terraform output -raw website_bucket_name
terraform output -raw cloudfront_distribution_id
```

```bash
aws s3 sync dist s3://BUCKET_NAME/ \
  --delete \
  --exclude "viewer-input/*" \
  --exclude "api/*"
aws s3 sync viewer-input s3://BUCKET_NAME/viewer-input/ \
  --exclude "*" \
  --include "train_index.json" \
  --include "path_catalog.json" \
  --include "station_line_catalog.json"
aws cloudfront create-invalidation \
  --distribution-id DISTRIBUTION_ID \
  --paths "/*"
```

`--delete` はアプリケーションルートの古いビルド成果物を削除する。
`viewer-input/` はサイズが大きく別コマンドで管理し、`api/` は収集Lambdaが管理するため、
どちらも明示的に削除対象から除外する。

日次バッチ導入後、`train_index.json`と`path_catalog.json`はECSが管理する。
手動同期は初回移行または障害復旧時だけに限定し、通常のWebデプロイでは更新しない。

## data-builder日次バッチ

ECS、ECR、Scheduler、入力S3、VPCは`transitforge-data-builder`リポジトリの
Terraformが所有する。TransitForge側はWeb用S3、CloudFront、およびdata-builderの
GitHub Actionsが専用TerraformをapplyするためのOIDCロールだけを管理する。

data-builderは2026年7月15日以降に作成されたGitHubリポジトリなので、OIDCの`sub`には
owner IDとrepository IDを含むimmutable subjectを使用する。実際の値は
`data_builder_github_oidc_subject`で明示的に管理し、CloudTrailで観測したsubjectと
IAMロールの信頼条件を一致させる。

TransitForgeのTerraform適用後、data-builderへ渡す値を確認する。

```bash
terraform output -raw website_bucket_name
terraform output -raw data_builder_github_deploy_role_arn
```

`ymho/transitforge-data-builder`のGitHub `dev` environmentへ次の変数を設定する。

| 種別 | 名前 | 値 |
| --- | --- | --- |
| Environment variable | `AWS_DEPLOY_ROLE_ARN` | `data_builder_github_deploy_role_arn`の出力 |
| Environment variable | `VIEWER_INPUT_BUCKET_NAME` | `website_bucket_name`の出力 |
| Environment variable | `TF_STATE_BUCKET` | bootstrapの`state_bucket_name`の出力 |

data-builderのmain更新時に、GitHub ActionsがOIDCで専用Terraform stateをapplyし、
続いてDockerイメージをECRへ公開する。入力GeoJSONの配置、日次実行、障害確認は
data-builder側の運用手順を正とする。

## GitHub Actions

Terraformを最初にローカルからapplyしてGitHub OIDCプロバイダーとデプロイロールを
作成する。その後、GitHubリポジトリに`dev` environmentを作り、次を設定する。

| 種別 | 名前 | 値 |
| --- | --- | --- |
| Environment variable | `AWS_DEPLOY_ROLE_ARN` | `terraform output -raw github_actions_deploy_role_arn` |
| Environment secret | `BASIC_AUTH_CREDENTIALS_SHA256` | `trf:パスワード`のSHA-256 |
| Environment secret | `VITE_MAPBOX_ACCESS_TOKEN` | Mapboxの公開トークン |

Pull Requestとmainへのpushでは`.github/workflows/ci.yml`がテスト、ビルド、
Terraform検証を行う。mainへのpushまたは手動実行では同じWorkflowがOIDCでAWSへ
接続し、Terraform apply、S3同期、CloudFront無効化を順に行う。データ量の大きい
`viewer-input/`とLambdaが更新する`api/`はCI/CDの同期対象外とする。

GitHub environmentの必須レビュアーやmainのbranch protectionを設定すると、
意図しないデプロイに対する追加の承認境界になる。

## 運行情報アーカイブ

- 最新値: Web用S3の `api/traffic/trainmonitorinfo.json`
- 履歴: 専用S3の
  `raw/year=YYYY/month=MM/day=DD/hour=HH/collected_at=...json.gz`
- 時刻パーティション: 日本標準時
- 既定の保持期間: 730日
- Scheduler再試行: 0回
- 重複取得防止: 分単位のS3条件付き書き込み
- 分析索引: DynamoDBの
  `serviceDate (JST日付) + collectedAt (UTC収集時刻)`
- 保存分析値: 全列車合計、列車数、車両数、列車番号別合計
- 問い合わせ時集計: 日次ピーク、JST時間別平均・ピーク、列車別平均・ピーク、
  ブラウザで付加する行き先側路線・種別・列車名・行き先
- DynamoDB TTL: S3と同じ既定730日

列車遅延の最新統合値はWeb用S3の`api/traffic/delays.json`、全取得結果は専用の
非公開遅延アーカイブS3へ保存する。遅延収集はScheduler再試行0回、Lambda予約済み
同時実行数1、分単位S3条件付きclaimを併用し、1実行で各URLを最大1回だけ取得する。
同じ列車番号が複数URLにある場合は最大遅延分を採用する。遅延DynamoDBには観測列車数、
遅延列車数、遅延分合計・最大、列車番号別遅延分を1分1項目で保存する。

取得に失敗した回は保存せず、次の1分実行まで待つ。利用者数が増えても上流アクセス数は
増えない。保持期間は `train_monitor_archive_retention_days` で30〜3650日に変更できる。

既存S3アーカイブを新しい分析索引へ取り込む場合は、対象のJST日付を指定してcollectorを
手動実行する。

```bash
aws lambda invoke \
  --function-name transitforge-dev-train-monitor-collector \
  --cli-binary-format raw-in-base64-out \
  --payload '{"mode":"backfill","date":"2026-07-30"}' \
  backfill-result.json
```
