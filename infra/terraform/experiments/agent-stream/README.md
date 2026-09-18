# Agent stream非本番PoC

#462の独立experiment。`enabled=false`が既定で、dev環境やCDから参照しない。
**このPRではAWSへのplan/apply/deployを実施していない。実リソース作成は別途明示承認が必要。**

既存#451のUser Pool/client/scopeを入力し、認証基盤を作り直さない。
合成scenarioとfake model＋実Server Agentのみを実行し、IAMにBedrock・DB・Provider権限を付けない。
Node.js22 LambdaはVPC外。固定IP Provider配置とは独立である。

```bash
# repository root: bundleはGit対象外の一時directoryへ
mkdir -p /tmp/agent-stream-poc
npx esbuild backend/agent-api/src/agent-stream-poc-lambda.ts --bundle --platform=node --target=node22 --format=cjs --outfile=/tmp/agent-stream-poc/index.cjs
# handlerをindex.handlerとして展開するZIPを作成（deployではない）
(cd /tmp/agent-stream-poc && zip agent-stream-poc.zip index.cjs)

terraform -chdir=infra/terraform/experiments/agent-stream init -backend=false -input=false
terraform fmt -check -recursive infra/terraform/experiments/agent-stream
terraform -chdir=infra/terraform/experiments/agent-stream validate
terraform -chdir=infra/terraform/experiments/agent-stream test
```

`terraform test`はmock_providerでdisabled=0 resourcesとSTREAM/scope/timeout/VPC非依存を確認する。
テストでlambda_zipにHCLを指定するのはhash入力だけで、実Lambdaへ送れるartifactではない。
AWS Provider 6.57.1のschemaで`response_transfer_mode`、`response_streaming_invoke_arn`、
CloudFront originの`response_completion_timeout`を確認した。lockは既存devのAWS固定版checksumを再利用する。

承認後の実験では実artifactの絶対path、同じRegionのUser Pool ARN/ID、client ID、scenarioを明示する。
production state/backendを使用しない。短期実験終了後の削除も承認された範囲で行う。
まず`immediate`、次に`over30`/`ninety`/`minutes`/`initial_delay`/`silent`/`mid_error`/
`missing_final`、最後に`server_agent`へ環境設定を変え、BrowserからPOSTする。
Access TokenはAuthorization headerだけに置き、ログ・URL・tfvarsに保存しない。
同一originのBrowser利用を想定し、CORSを広く許可していない。

この設定はCloudFrontを通さないREST URLにもCognito認証を要求するが、CloudFront経由を強制しない。
productionでは#480でWAF/Origin制限、access logの安全な項目、実quotaとcold start、
旧Function URL閉鎖を確認する。現PoCのログはLambda標準ログのみで、本文/Tokenのdata traceは無効。

詳細と未実施条件: [検証記録](../../../../docs/experiments/agent-stream-462.md)。
