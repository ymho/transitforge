# AWS dev環境

静的ビューワー AI API 混雑と遅延の収集基盤をTerraformで管理する

## 管理範囲

- 非公開S3とCloudFront
- Cloudflare AOPで保護する独自ドメイン配信
- 認証済みRegional RESTのServer Agent stream / Conversation / Profile V3 / Trip V2と専用Lambda・限定IAM
- 残存UI read operationのLambda Function URL / OAC。汎用会話・feedback・traceは410
- 旅行提供者へ固定IPで接続するAI LambdaのNATインスタンスとElastic IP
- 過去のfeedback / Trace契約用の非公開S3。旧公開送信operationは410で、resource残存を送信機能の稼働と扱わない
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

相談のAgent LambdaはStrands v2専用で、`AGENT_RUNTIME=strands-v2`と`bedrock_model_id`を使う。
旧Runtime選択と旧Semanticフラグは撤去した。devのCDはSonnetを明示する。
地点詳細など他LambdaのBedrock設定は独立して保持する。復旧は
[Agent v2実環境運用](../../../../docs/architecture/agent-v2-development-cutover.md)に従う。

手動の`Agent Eval / Strands v2 Live`は同じ`dev` environmentのOIDC trustを使うが、
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

## OTP経路サービス

Data BuilderはGTFSとOSMから`otp/izumo-matsue/versions/<version>/`へgraphとmanifestを配布する。本リポジトリは指定したversionだけをS3から読み、private subnetのECS FargateでOTPを常駐させる。非VPCのAgent LambdaはOTPへ直接接続せず、IAM Invokeだけを許可したVPC Bridge Lambdaを経由する。OTPにはpublic ingress、ALB、Function URLを作らない。

OTPの有効化、固定graph version、完全なgraph SHA-256、digest固定したOTP imageとgraph loader imageは、非秘密かつレビュー可能な`otp-runtime.auto.tfvars.json`を正本にする。初回は`enable_otp_route_service=false`のままData Builderの手動生成を完了し、manifest、graph hash、OTP image、GTFS有効期間を確認する。その後、同じOTP image、graph version、完全なgraph SHA-256を`otp-runtime.auto.tfvars.json`へ記録してplanを確認する。init containerはダウンロードしたgraphのSHA-256が一致しない限りOTPを起動しない。`current.json`だけでは稼働中サービスを切り替えない。Graph更新時は新versionでECS taskを入れ替える。CDはECSの安定化を待ち、Bridge Lambda経由の徒歩経路smokeを確認する。さらに徒歩・バス・対象外日・経路なしを確認してから旧taskを停止する。

2026-09-28時点の初回候補では、OTP 2.10.0を`docker.io/opentripplanner/opentripplanner@sha256:8d54e5c589186707ee365417f2202dc878c451fa3001b8edff07019531100933`、graph loaderをAWS CLI 2.37.4の`public.ecr.aws/aws-cli/aws-cli@sha256:fdd8d1fcbea9c371678dee5a40df8b178c7a781b4586605756ee28114c97ead6`として確認した。いずれもmulti-architecture manifest digestである。設定時はData Builderのmanifestと一致すること、各registryでdigestを再確認する。

## 独自ドメインの初回導入

正規URLは`https://app.ohmyki.com`とする
Cloudflareのper-hostname Authenticated Origin PullsとCloudFront viewer mTLS required modeを組み合わせる
CloudFront Basic認証は使用せず 利用者機能はCognito認証へ統一する
独自ドメイン用Distributionは`Cloudflare-CDN-Cache-Control: no-store`を返し Cloudflareへ認証状態やAPI応答を保存しない
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
11. Homeが未認証で表示でき 各機能入口がCognito Managed Loginへ進むことを確認
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
Managed Login v2と標準brandingを管理する。公開APIへの接続は`agent-stream.tf`と各専用hostが所有する。
callbackは`https://${viewer_domain_name}/index.html`、logoutは同originの`/`へ限定する。
localhostを許可するdev環境だけ`cognito_local_development_enabled = true`を指定する。

CDはapply後の`cognito_frontend_config`を`dist/auth-config.json`へ出力し、静的assetと一緒に配信する。
これは公開設定でありsecret/tokenを含まない。issuer/client/scopeをGitHub VariablesやFrontendへ再定義しない。
ローカル開発では適用済みdev stateから次の公開出力を取得する（ファイルはGit管理外）。

```bash
mkdir -p ../../../../frontend/public
terraform output -json cognito_frontend_config > ../../../../frontend/public/auth-config.json
```

`cognito_api_auth_config`のpool / client / requiredScopesは専用Lambdaの共通verifierへ接続済み。
Trip公開writerは認証済み専用hostから有効。共有も同じ専用hostで有効。通知・in-tripの未公開gateは別境界で維持する。
ID TokenはAPIへ送らない。残存Function URLのOACはorigin保護であり、利用者認証を代替しない。

アカウント入口の「ログイン」から日本語Managed Loginへ進む。User Poolの自己登録は無効で、
新規登録リンクを表示せず、公開App ClientのSignUp APIも拒否する。新しい利用者はCognito管理者だけが作成する。
パスワードは12文字以上で英大文字・小文字・数字・記号を必須とする。Access/ID Tokenは5分のまま、
Refresh TokenをsessionStorageへタブ単位で保持して失効前と401時に1回だけ更新する。ログイン開始から
最大12時間の絶対期限は更新で延長しない。詳しい保存・logout保証と未実施の実環境試験は
[ADR 0069](../../../../docs/decisions/0069-use-cognito-managed-login-for-spa.md)を参照する。

## Fixed-egress Provider（#480 Phase B）

`fixed-egress-provider.tf`は宿泊Provider専用Lambdaを既存private subnet/HTTPS SGへ追加する。
Terraform単体の`enable_fixed_egress_provider`既定はfalseだが、Server構成はtrueを必須とし、CDで明示する。
Agent roleからProvider LambdaへのIAM Invokeを接続し、既存NAT / EIPを使う。専用Secretの値はTerraformで管理しない。
導入記録は[固定egress Provider](../../../../docs/architecture/fixed-egress-provider.md)、
Current構成は[Server Agent](../../../../docs/architecture/server-agent-cutover.md)を参照する。

## Server Agent Streaming

Regional REST、Server Agent、personal-state、Trip APIとCloudFront behaviorは`agent-stream.tf`が管理する。
既存resource addressを保つためfor_each keyは`"stream"`で固定する。短命の`agent_stream_enabled` gateは撤去済みである。
正本は`agent-stream.tf`で、experiment rootのfixture構成には依存しない。
AWS applyせず確認する手順と公開経路のCurrent / Historical区別は
[Streaming実装記録](../../../../docs/architecture/agent-streaming-production.md)を参照。
`terraform test -filter=tests/agent-stream.tftest.hcl`はmock providerのoffline planだけを実行する。

相談条件のTrip反映はServer Agent自身が`DynamoDbTripRepository.applyMutation`を通じて行う。
そのためAgent roleには既存のTrip `GetItem`に加え、Tripテーブル限定の`PutItem`・`UpdateItem`を
`dynamodb:EnclosingOperation = TransactWriteItems`条件付きで許可する。Trip更新・mutation receipt・
TripChanged outboxを同一transactionで保存するための権限で、単独write・削除・Scan・indexアクセスは追加しない。
owner検証とrevision/CASはApplication/Repositoryが引き続き担う。
offline testはこのIAM契約を検査する。実モデルテストでもDB fixtureを使う場合はAWS権限を検証できないため、
反映後は認証済み相談で条件のTrip保存と`publish` / `respond` / `save completed`を確認する。

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
実行上限で、旧Browser Runtimeは撤去済み。35/90/180秒のtransport fixtureとは分ける。

## 公式しおりの発行アカウント (#821)

Cognito管理者が公式用アカウントを作成し、その`sub`をdev EnvironmentのGitHub Variable
`OFFICIAL_PUBLISHER_SUBJECTS_JSON`へJSON配列で設定する。CDは`TF_VAR_official_publisher_subjects`として渡す。
未設定時は空配列で、一般ユーザーには公開操作を出さない。Frontendへsubject一覧を渡さない。
次回デプロイ後、公式アカウントは通常の旅程画面から「共有」→「公式しおりとして公開・更新」を行う。
公開は通常の共有Grantと独立した全ユーザー向けsnapshot。詳細は[公式しおり仕様](../../../../docs/architecture/official-guides.md)。
