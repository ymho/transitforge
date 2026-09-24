# Regional REST Streamingの本番構成

> 2026-09-19 / #481 Batch 3: Server Agentはproduction current。`agent_stream_enabled`、
> `AGENT_STREAM_ENABLED`、`VITE_SERVER_AGENT_ENABLED`、`SERVER_AGENT_ENABLED`の短命cutover gateは撤去した。
> 以下のdefault-off/cutover前記録はHistoricalである。

[ADR 0070](../decisions/0070-select-regional-rest-agent-streaming.md)の判断を実装へ落とした記録。
ADRを置換しない。#488がmainへ入った`9224536`から実装し、#462は実AWS検証を残してOpen。
本PRでAWS apply/deploy、Browser切替、既存Function URL閉鎖は行っていない。

## 正本とdefault-off

現行リポジトリにはdev/prod共用Terraform moduleや独立prod rootがなく、環境パラメーターを持つ
`infra/terraform/environments/dev`が正本。既存の配置に合わせて`agent-stream.tf`を追加した。
`environment=prod`もmock planで確認するが、実prod環境への配置実績を意味しない。
experiment rootは再現用として残し、本番rootから参照しない。PoCのscenario/fixture/独立CloudFrontは移植しない。

`agent_stream_enabled=false`が既定。新Lambda、REST API、権限、Log GroupとCloudFront origin/behaviorは
作成されず、既存`/api/agent`とBrowserの設定は変わらない。tfvars exampleやCDで有効化しない。
有効時は`/api/agent-stream`を用意する。後続の[統合](server-agent-cutover.md)でBrowser build gateから接続する。
Lambda自身も`AGENT_STREAM_ENABLED`が文字列`true`でなければ503を返し、認証・model・Toolを呼ばない。

このgateは#480後半の移行用であり、恒久的なdual runtime選択ではない。実AWS gate通過後に
`agent_stream_path_part`と旧behaviorを一緒に切り替え、Browser接続、旧経路閉鎖を完了してgateを撤去する。
パスの正本はTerraform localで、REST resource、invoke permission、CloudFront、Lambda検証に渡す。

## CloudFront → Regional REST → Lambda

- 既存website distribution（redirect専用時を除く）とcustom-domain viewer distributionに条件付きorigin/behaviorを追加する。
- Regional RESTのPOSTだけを`AWS_PROXY` / `STREAM`、Lambda `response_streaming_invoke_arn`へ接続する。
- invoke permissionはそのAPI、環境stage、POST、新pathへ限定する。新Function URLは作らない。
- CloudFrontはManaged-CachingDisabled、圧縮なし、接続試行1回、HTTPSのみ。
  Managed-AllViewerExceptHostHeaderでBearer Authorizationをoriginへ渡し、cache keyには入れない。
  Basic auth viewer functionは新routeへ付けない（同じAuthorizationヘッダーを消費するため）。
- 新routeにCloudFront request loggingは追加しない。既存custom-domainのCloudflare-CDN-Cache-Control: no-storeも適用する。
- ADR値を維持: Lambda 240秒、Gateway 250秒、CloudFront read 60秒/completion 260秒。
  認証・入力検査後に`understanding_request` progressをwriteし、Application実行中は10秒heartbeat。
  Browser consumerのidle 45秒/deadline 270秒はPoC契約のままで、本番Browserは未接続。
  cold start/JWKS/Authorizerは最初の待ち時間へ含む。heartbeatは有用回答でもトークンstreamでもない。

[REST streaming仕様](https://docs.aws.amazon.com/apigateway/latest/developerguide/response-transfer-mode.html)と
[CloudFront timeout仕様](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistValuesOrigin.html)
を2026-09-18に再確認した。Terraform schema/fixture成功はAWS quotaや全経路の逐次受信の保証ではない。
前段CDNを含むbuffering/timeoutは統合段階で確認する。

## 認証とApplicationの境界

GatewayのCognito User Pool Authorizerとrequired scopeは既存`users` / `spa` / resource serverを使用する。
Backendは#484のAccessTokenVerifierとauthenticatedApplicationで署名、期限、issuer、client、access token種別、
required scopeを検査してTrustedPrincipalを渡す。claims/body principalは信用しない。
未認証、期限切れ、別issuer/client、ID Token、scope不足、query token、重複AuthorizationはApplication組成前に拒否する。

execute-api URLはネットワーク上到達可能だが、同じCognito＋scopeとBackend verifierを必ず通る。
CloudFrontのみの認証へ依存せず、直接URLは利用者認証の迂回路にならない。CloudFront限定のネットワーク制限を
実装済みとは主張しない。直接URLを含む実認証E2Eは#480統合gateで確認する。

`agent-stream-lambda.ts`は別artifactのentrypoint、`agent-stream-composition.ts`は
`createApplication(executionId)`でServer Agent Applicationを受ける。transport handlerは既存handler群と
同じBackend入口責務として配置し、AWS固有stream/eventは`adapters/agent-stream/lambda.ts`へ閉じる。
PoCのHTTP/auth/framing処理は`agent-stream-handler.ts`へ昇格し、PoC側は同じ正本を呼ぶ。

Phase A時点のentrypointは既存Bedrock model、system prompt、Server Agentとweather Toolの最小composition。
#479のContext Loader付きApplication factoryへ差し替える境界までを用意したもので、
Conversation/Profile/Tripを独自読込しない。State/Secrets権限も付与しない。全Tool接続は未完了でcutover候補ではない。
共通API auth middleware、Trip handler、server-agent.ts、Agent decision logicは変更しない。

新LambdaはVPC外。ADR 0019のfixed-IP Providerは`additionalTools`のoperation Portの先で
専用VPC boundaryへ後続接続する。今は固定IP Providerを直接接続せず、既存NAT/EIPを変更しない。

## 監視と失敗

Lambdaは許可したフィールドだけをJSON記録する。
`request_started`、`stream_started`、`final_sent`、`completed` / `error` / `disconnected`、拒否時`rejected`を記録する。
requestIdとAgent executionIdは同じserver生成UUID、SSE runIdも同値。
Lambda awsRequestIdとGateway extendedRequestIdをadapterで受け、latencyMs、拒否HTTP statusと相関する。
Gateway IDはcallerが差し替え可能な通常requestIdではなくextendedRequestIdをLambda側の結合キーとする。
final_sentはwrite成功後、completedはdone/write/end成功後。相手Browserでの受領保証ではない。

API stage access logはrequestId、extendedRequestId、status、response/integration latencyだけ。
body/header/identity/error messageは記録せず、execution logging OFF、data trace OFF、metrics ON。
Lambda/API logは30日保持。token、生会話、Profile、raw Tool、traceをログへ出さない。
Lambda roleは専用logと選択Bedrock modelのInvokeModelだけを許可する。
Gatewayのrate 1/s・burst 2、Lambda reserved concurrency 1は初期の保守的な上限であり、負荷調整は統合時に行う。

Runtime完了時は内容を含まない`runtime`診断を追加し、`completed`、`budget_exhausted`、
`provider_timeout`、`schema_invalid`、`failed`を区別する。実行上限はSSEでも`limit_reached`のまま公開し、
保存層や画面で一般障害へ潰さない。Browserは条件が保持されていることと再開方法を表示する。
`building_answer`後の最終応答が構造化contractまたはEvidence表示検証に失敗した場合は、Toolを追加実行せず、
残っているmodel budgetから1回だけ修復を要求する。再失敗は一般障害ではなく`limit_reached`として安全に終了する。

CDのdeploy実行は、直近2時間の`agent_diagnostic`とstream終端を会話本文・利用者識別子・実行IDを除いて
集計し、Job Summaryへ出力する。本番で公開エラーへ丸められた場合も、`context / runtime / save`と
`provider_timeout / schema_invalid / failed`の境界を、個人情報を取得せずに切り分けられる。

API Gateway CloudWatch roleはaccount/region単位のsingletonである。このrootには既存ownerがないため
新gate配下で定義するが、#451 Phase 3 merge後に既存ownerがあれば統合し、二重管理しない。
AWSで既存roleが設定済みの場合も所有権を確認してから有効化する。このPRではその設定を変更しない。

ヘッダー送信後の失敗はerror eventとdoneで表し、欠けたfinalは成功としない。
write失敗後の追加writeは止める。Browser切断はLambda/model停止・課金停止を保証せず、240秒の上限を維持する。
自動retry、Browser Agentへの無言fallbackは追加しない。

## 公開進捗phase

本番streamは最終回答まで無言にせず、Applicationが実際に通過した`understanding_request`、
`checking_information`、`comparing_options`、`building_answer`、`validating_answer`をprogress eventとして送る。
連続する同一phaseはtransport境界で一度にまとめる。これは利用者へ待機理由を示すUI状態であり、モデルの
thinking、仮説、prompt、Tool名・入力・結果、Evidence本文を含めない。永続化、再生、Traceへの転用もしない。
heartbeatは接続維持だけで、progress eventではない。旧PoC fixture向けの`running`はwire互換の受信だけ残す。

## 確認と後続

```bash
npm run build --workspace @raiquora/agent-api
npm run lambda:check --workspace @raiquora/agent-api
npm run architecture:check
npx vitest run backend/agent-api/src/agent-stream-composition.test.ts backend/agent-api/src/agent-stream-poc/handler.test.ts backend/agent-api/src/adapters/agent-stream/lambda.test.ts
terraform fmt -check -recursive infra/terraform
terraform -chdir=infra/terraform/environments/dev init -backend=false -input=false
terraform -chdir=infra/terraform/environments/dev validate
terraform -chdir=infra/terraform/environments/dev test -filter=tests/agent-stream.tftest.hcl
```

Terraform testはAWS/archiveをmockしたplanのみ。default-off、有効時のauth/stream/cache/timeout、
prod相当stage＋custom-domain構成を検査する。package checkはAWS streaming globalをshimし、gate未指定の503を確認する。
root全量testはCIへ任せる。独立したformat/lint scriptはなくtypecheck/architecture/diff checkを行う。
Agent Smoke/Full/Live Eval、実Cognito利用者作成、実Bedrock長時間試験、AWS E2Eは実施しない。

#451 Phase 3の共通認証と#479 Phase BのContext Loaderがmainへ揃った後、#480後半で
Application差替え、全Tool/State接続、fixed-IP Provider配置、35/90/180秒の実AWS E2E、
認証拒否・直接URL・切断・account/Trip切替・rollback、Browser cutoverと旧URL閉鎖を行う。
LocalStorageと既存Browser Agentの撤去、大規模README/product-brief整合は今回に含めない。#480はCloseしない。

## 統合段階の更新

[Server Agent cutover統合](server-agent-cutover.md)でstateful turnと必要なServer Toolsへ接続した。
State/Trip read・non-travel Secret・IAM Provider Invokeを最小権限で追加する。
BrowserはVITE_SERVER_AGENT_ENABLEDで明示選択し、default-offとAWS未切替を維持する。
