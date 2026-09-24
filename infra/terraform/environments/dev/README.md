# AWS dev環境

静的ビューワー AI API 混雑と遅延の収集基盤をTerraformで管理する

## 管理範囲

- 非公開S3とCloudFront
- Cloudflare AOPで保護する独自ドメイン配信
- AI駅員のLambda Function URLとBedrock権限
- 旅行提供者へ固定IPで接続するAI LambdaのNATインスタンスとElastic IP
- 明示的フィードバックとbounded Agent Traceを短期保存する非公開S3
- 混雑と遅延の収集Lambda EventBridge Scheduler S3 DynamoDB
- GitHub Actions用OIDCロール（デプロイ用とBedrockモデル評価専用）
- data-builderデプロイ用OIDCロール

data-builderのECS ECR 入力S3 Schedulerはdata-builderリポジトリが管理する

NATインスタンスは`t4g.nano`を既定とし 初回bootstrap前に512MiBのswapを作成する。
swapは`/etc/fstab`へ登録し 再起動後もNAT転送serviceとともに復旧する。

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

Bedrockは`bedrock_model_id`を通常の初期判断に使い `bedrock_decision_model_id`を
検証済みcurrentJourneyの判断とTool結果後の再計画に使う。`bedrock_lightweight_model_id`は
比較評価用とし 未設定classは既定modelへフォールバックする。modelまたはInference Profile IDは
TerraformとBedrock Adapterの両方で検証し Applicationへはprovider非依存の`default`
`lightweight` `decision`だけを公開する。routingの実測と採用判断はADR 0047 0048を参照する。

手動の`Agent Eval / Model Comparison`は同じ`dev` environmentのOIDC trustを使うが、
`transitforge-dev-github-agent-eval`へ直接認証する。このRoleはBedrockのsystem inference profile参照と
model invokeだけを許可し、デプロイRoleのPowerUser権限を比較処理へ渡さない。Role ARNは既存の
`AWS_DEPLOY_ROLE_ARN`から同一account内の固定名を組み立てるため、アクセスキーや追加Secretは不要である。

## GitHub Environment

`dev` environmentへ次の値を設定する

| 種別 | 名前 | 用途 |
| --- | --- | --- |
| Variable | `AWS_DEPLOY_ROLE_ARN` | TransitForgeのデプロイロール |
| Variable | `TF_STATE_BUCKET` | 共有stateバケット |
| Variable | `DATA_BUILDER_GITHUB_OIDC_SUBJECT` | owner IDとrepository IDを含むdata-builderのimmutable subject |
| Variable | `CLOUDFLARE_FRONT_DOOR_ENABLED` | 独自ドメイン用CloudFrontの段階導入フラグ |
| Variable | `LEGACY_CLOUDFRONT_REDIRECT_ENABLED` | 既存CloudFront URLのリダイレクト切替フラグ |
| Variable | `ACCOMMODATION_PROVIDER_DISPLAY_NAME` | 設定画面へ表示する宿泊提供者名 |
| Variable | `ACCOMMODATION_PROVIDER_CREDIT_URL` | 宿泊提供者のクレジットリンク |
| Variable | `ACCOMMODATION_PROVIDER_CREDIT_IMAGE_URL` | 宿泊提供者のクレジット画像 |
| Variable | `ACCOMMODATION_PROVIDER_CREDIT_ALT` | クレジット画像の代替テキスト |
| Secret | `BASIC_AUTH_CREDENTIALS_SHA256` | 開発環境の認証情報ハッシュ |
| Secret | `VITE_MAPBOX_ACCESS_TOKEN` | Mapbox公開トークン |

## 外部旅行提供者の認証情報

旅行提供者の認証情報はGitHub Secretsや`.env.local`ではなく AWS Secrets Managerへ保存する。
Terraform apply後に`/transitforge/dev/travel-provider`が作成されるため AWSコンソールまたは次の形式で値を登録する。

```json
{
  "application_id": "旅行提供者アプリID",
  "access_key": "旅行提供者アクセスキー",
  "hotel_search_url": "旅行提供者の宿泊検索API URL",
  "vacant_hotel_search_url": "旅行提供者の日付別空室検索API URL（任意）",
  "mapbox_search_access_token": "Mapbox Search Box API用アクセストークン（任意）",
  "brave_search_api_key": "Brave Search API Key（任意）",
  "hot_pepper_api_key": "飲食店検索API Key（任意）"
}
```

`vacant_hotel_search_url`を設定すると 宿泊候補の施設番号をまとめて日付と大人人数付きで再照会し
確認できた候補だけを空室ありとして扱う。未設定または空室照会に失敗した場合は
通常検索の参考最安料金だけを保持し 空室未確認として表示する。

`hot_pepper_api_key`を省略した場合は飲食店検索だけが利用不可になる。気象庁防災情報はキー不要で
Mapbox Navigationは既存の`mapbox_search_access_token`を共有する
Mapboxへのサーバー通信はURL制限付き公開トークンを地図表示と共有できるよう
`viewer_domain_name`から生成した正規Viewer URLを`Referer`として一元付与する。

`affiliate_id`は予約リンクの計測が必要な場合だけ指定する。Mapbox Searchを使わない場合は
`mapbox_search_access_token`を省略できる。
Mapbox Search未設定時はWikipediaを地点同定だけのfallbackに使い Wikipediaの写真と説明は会話へ表示しない。値はTerraform stateやGitHubへ保存せず AI Lambdaだけが実行時に取得する。
`brave_search_api_key`はWeb検索と画像検索で共有し、省略した場合はこれらの検索を利用できない。Google Custom Search JSON APIは
新規利用を受け付けていないため Web検索はベンダー非依存のPortへBrave Search Adapterを接続する。
Raiquora自身のOIDC対象リポジトリはGitHub Actionsの`github.repository`から渡す
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

- TypeScriptテストとrepository保守toolのPythonテスト
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

## CognitoとSPA認証（#451第二段階）

`cognito.tf`がEssentials User Pool、secretなしSPA Client、`raiquora/user` Resource Server、
Managed Login v2と標準brandingを管理する。料金条件を確認してから通常のCDで適用する。
callbackは`https://${viewer_domain_name}/index.html`、logoutは同originの`/`へ限定する。
localhostを許可するdev環境だけ`cognito_local_development_enabled = true`を指定する。

CDはapply後の`cognito_frontend_config`を`dist/auth-config.json`へ出力し、静的assetと一緒に配信する。
これは公開設定でありsecret/tokenを含まない。issuer/client/scopeをGitHub VariablesやFrontendへ再定義しない。
ローカル開発では適用済みdev stateから次の公開出力を取得する（ファイルはGit管理外）。

```bash
mkdir -p ../../../../frontend/public
terraform output -json cognito_frontend_config > ../../../../frontend/public/auth-config.json
```

`cognito_api_auth_config`の`userPoolId`/`clientId`を#484のverifierへ、`requiredScopes`を共通認証Applicationへ
渡すことを後続server wiringの契約とする。本段階ではLambda environment/handler/Runtimeを変更しない。
ID TokenはAPIへ送らない。Basic認証とOAC、既存の公開writer gateも維持する。

設定画面の「ログイン / 新規登録」から日本語Managed Loginへ進む。Access/ID Tokenは5分のまま、
Refresh TokenをsessionStorageへタブ単位で保持して失効前と401時に1回だけ更新する。ログイン開始から
最大8時間の絶対期限は更新で延長しない。詳しい保存・logout保証と未実施の実環境試験は
[ADR 0069](../../../../docs/decisions/0069-use-cognito-managed-login-for-spa.md)を参照する。

## Fixed-egress Provider（#480 Phase B）

`fixed-egress-provider.tf`は宿泊Provider専用Lambdaを既存private subnet/HTTPS SGへ追加する。
`enable_fixed_egress_provider=false`が既定で、現在のAI Lambda・NAT/EIP・production trafficは変更しない。
`fixed_egress_agent_role_name`は統合時にVPC外Server roleを指定するための任意入力であり、未指定ではInvoke権限を付けない。
専用Secretの器だけを作り値は管理しない。共有Secretからの宿泊credentials移行・Tool接続・実plan確認は
[#480統合手順](../../../../docs/architecture/fixed-egress-provider.md)に従う。今回apply/deployは行わない。

## Server Agent Streaming

Regional REST、Server Agent、personal-state、Trip APIとCloudFront behaviorは`agent-stream.tf`が管理する。
既存resource addressを保つためfor_each keyは`"stream"`で固定する。短命の`agent_stream_enabled` gateは撤去済みである。
正本は`agent-stream.tf`で、experiment rootのfixture構成には依存しない。
AWS applyせず確認する手順と#451/#479後の有効化条件は
[Streaming実装記録](../../../../docs/architecture/agent-streaming-production.md)を参照。
`terraform test -filter=tests/agent-stream.tftest.hcl`はmock providerのoffline planだけを実行する。

## Deployment safetyとplan-only CD

`dev` Environmentの`FIXED_EGRESS_PROVIDER_ENABLED`はCDで明示する。これはServer Agent切替ではなく、
固定IP Provider境界のCurrent infrastructure requirementである。streamingとBrowserの短命gateはない。
既存resourceの削除・replaceはplan guardで拒否する。
例外はstream ON時の`aws_api_gateway_deployment.agent_stream["stream"]`の厳密な
`["create", "delete"]`だけで、構成snapshotの安全な世代交代を許可する。
旧revisionのCDはguardを持たないので再実行しない。

手動`CD / Deploy`のmode既定は`plan`。本番の保護された認証入力でplanを作り、値を含まない
resource action一覧をstep summaryへ出す。AWS lockfileも作らず、apply/S3配信/invalidationは行わない。
`deploy`を明示した手動実行とmain CI成功時だけ、再plan・guard後に従来のapply/配信を実施する。
今回このworkflowは起動しない。詳細は[cutover契約](../../../../docs/architecture/server-agent-cutover.md)を参照する。

stream Lambdaの`SERVER_AGENT_MAX_EXECUTION_MS`はTerraformの`server_agent_max_execution_ms`
から生成する。推奨・既定150000ms、許容範囲は整数1000〜180000ms。Lambda240秒とは別のbusiness
実行上限で、共有Browser Runtimeの15秒設定は変更しない。35/90/180秒のtransport fixtureとは分ける。
