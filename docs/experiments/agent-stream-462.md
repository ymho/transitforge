# Server Agent transport検証（#462）

確認日: 2026-09-18。基準main: `eb8b475`（#485）。AWSリソース作成・deploy・実Bedrock呼出しなし。
判断は[ADR 0070](../decisions/0070-select-regional-rest-agent-streaming.md)。

## コードから確認した現状

- `frontend/src/adapters/http/agent-api/bedrock-agent.ts`はPOST `/api/agent`へJSONを送り、`response.json()`で完了を待つ。一部呼出しに既存の自動再試行がある。
- `infra/terraform/environments/dev/main.tf`と`custom-domain.tf`のCloudFrontはLambda origin/OACを使う。OACは`always` SigV4、`/api/agent`はCachingDisabledとAllViewerExceptHostHeader。既存Basic保護・圧縮の設定がある。
- `bedrock-agent.tf`はFunction URLが`AWS_IAM`/`BUFFERED`、Lambda timeoutが60秒、Lambda全体にVPC設定がある。CloudFrontのorigin response/completion timeoutは明示設定なし。これはTerraform上の棚卸しであり、deploy済みの値をAWSから取得した結果ではない。
- `backend/agent-api/src/lambda.ts`は既存Agent operation handlerを呼ぶ。#478の`createServerAgent`/`runAgentTurn`は追加されたが、公開handlerへの接続はまだない。production Browser compositionも#480まで残る。
- PoCは独立した入口から **1 POST → 1 Server Agent run → model/Tool loop → final** を呼ぶ。旧Browser往復を測定単位にしない。
- 実DNS/CDN経路・Cloudflareの有無・AWS Region内の機能提供・アカウントquotaは未確認。

## 公式資料の再確認

すべて2026-09-18に参照。検索記事の古い「API Gatewayではstreaming不可」を採用しない。

| 一次情報 | 確認した制約 |
| --- | --- |
| [REST response streaming](https://docs.aws.amazon.com/apigateway/latest/developerguide/response-transfer-mode.html) | RESTのAWS_PROXY/HTTP_PROXYのみ。STREAMは最大15分。Regional/Private idle 5分、edge-optimized idle 30秒。request streaming不可。cache/VTL response変換/サービス側content encodingは非対応 |
| [Lambda streaming統合](https://docs.aws.amazon.com/apigateway/latest/developerguide/response-streaming-lambda-configure.html) | `2021-11-15/.../response-streaming-invocations` URI。`HttpResponseStream.from`でstatus/headersと8 null bytesの前置きを生成できる |
| [HTTP API quota](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-quotas.html) | HTTP API integration timeoutは最大30秒で引上げ不可。REST streamingとは別 |
| [Lambda response streaming](https://docs.aws.amazon.com/lambda/latest/dg/configuration-response-streaming.html) | Node.js managed runtime対応。最大200MB、最初6MB以降は2MB/s。Function URL streamingはVPC環境非対応。VPCからSDKでstream invocationする構成はLambda interface endpointの説明がある。Region提供状況を要確認 |
| [Function URL invoke mode](https://docs.aws.amazon.com/lambda/latest/dg/config-rs-invoke-furls.html) | BUFFEREDはInvoke、RESPONSE_STREAMはInvokeWithResponseStream。Function URLの設定変更だけでは既存buffered handlerが段階出力するようにはならない |
| [InvokeWithResponseStream API](https://docs.aws.amazon.com/lambda/latest/api/API_InvokeWithResponseStream.html) | SDK側はPayloadChunkとInvokeCompleteを扱う。HTTP本文のSSEとは別層。呼出し権限と最終error metadataの確認が必要 |
| [CloudFront origin timeout](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistValuesOrigin.html) | response timeoutは最初の応答とpacket間の待ち時間で既定30秒。completion timeoutは全応答の上限で、未設定ならCloudFrontは最大値を強制しない。POSTのread timeout時にCloudFrontは再接続しない |
| [Cognito REST Authorizer](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-enable-cognito-user-pool.html) | methodにOAuth scopeを指定してAccess Tokenとして扱う。scope省略はID Token扱い。複数scope指定はany-ofなのでBackendのall-of検査とは区別する |
| [AWS Provider integration](https://registry.terraform.io/providers/hashicorp/aws/6.57.1/docs/resources/api_gateway_integration) / [公式実装ドキュメント](https://github.com/hashicorp/terraform-provider-aws/blob/main/website/docs/r/api_gateway_integration.html.markdown) | `response_transfer_mode`、streaming invoke ARNを公開。固定版ページは取得不可だったため、ローカルの6.57.1 provider schema・validate・mock planで実際の対応を確認した。mainのドキュメントだけで固定版対応と断定しない |
| [API Gateway料金](https://aws.amazon.com/api-gateway/pricing/) | REST streamingは10MB単位に切上げたrequest数＋転送。掲載例の1M×5KBはrequest $3.50＋転送$0.43。これは掲載地域の例で東京見積ではない。Lambda/CloudFront/ログとモデル料金は別 |

Lambdaのクライアント切断は実行停止・課金停止の保証にならない。[Lambda実行上限は15分](https://docs.aws.amazon.com/lambda/latest/dg/configuration-timeout.html)だが、
本PoCはそれより短い240秒。Gateway最大15分を「最初のbyteまで15分待てる」と解釈しない。

Authorization転送には[AllViewerExceptHostHeader](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-origin-request-policies.html)を使う。

## PoC構成

- `modules/agent/runtime/agent-progress.ts`: transport非依存のprogress/final/error契約。
- `usecases/agent/observe-agent-turn.ts`: 既存Server entryを1回呼び、検証済み回答を最終projectionへ変換する。Runtime coreのloop・Groundingは変更しない。
- `agent-stream-poc/handler.ts`: JWT認証/入力検証後に200/SSEを開始。raw Trace/Tool/Provider/内部推論は送らない。
- `adapters/agent-stream/lambda.ts`: REST proxy eventとLambda stream前置き、write callback/backpressureを所有する。
- `agent-stream-poc-lambda.ts`: production artifactへ含めないdefault-off entry。scenarioは環境設定で固定。実AWS用は既存Cognito verifierを使い、fake principalを受け入れるrouteは作らない。
- `infra/terraform/experiments/agent-stream`: 既存dev/CDから参照しない独立root。`enabled=false`で0 resources。既存の#451 User Pool/clientを入力し、新規Cognito/UIやProvider/VPCを作らない。Regional REST/STREAM＋scope、専用Lambda、CloudFrontのみ。
- Browser consumerはproduction compositionに未接続。POST Bearer＋fetch、キャッシュ/redirect禁止、自動再接続なし。tokenをqueryへ置かない。
- 段階表示は固定の`running`のみ。heartbeatはSSE commentで10秒間隔。最終回答・最終errorの後にtransportの`done`とEOFを要求し、途中切断を成功にしない。finalはdone/EOFを検証するまでUIへ確定反映しない。
- 途中のstructured updateとtoken-by-token生成は未実装。ConverseStreamをつなぐだけでは未検証の事実が表示されるため、別途公開projection設計が必要。

## 設定案と測定指標

| 層 | PoC案 |
| --- | --- |
| Application | 既存Runtime limitsを維持。合成180秒はRuntimeを模倣するfixtureで、production予算ではない |
| Lambda | timeout 240秒、reserved concurrency 1、model/Provider/DB権限なし |
| Regional REST | STREAM、integration timeout 250秒、scope `raiquora/user`、rate 1/s・burst 2 |
| CloudFront | read timeout 60秒、completion 260秒、接続試行1回、cache無効、圧縮無効、Authorization転送、Hostはoriginへ置換 |
| Browser | idle 45秒、deadline 270秒、abort・世代変更時は受信停止/遅着破棄 |

45秒の無通信でBrowserがCloudFrontより先に諦める設計。認証前はheartbeatを出さないため、JWKS取得・cold start・Authorizer遅延も最初の待ち時間へ入る。
REST直接URLにも同じAuthorizer/Backend verifierがかかるが、CloudFront/WAF経由の強制はこのPoCでは未実装。#480で迂回経路制限を設計する。

`requestStart`はBrowserのperformance clock。TTFBはBrowser readerが最初のbody byteを得た時間で、headers到着とは別。
TTFIは有用な最終回答をDOM callbackへ反映した時間。heartbeat/runningは有用な回答とは数えない。
completionはdone/EOF確認後。最大無通信はbyte間隔（initial waitと終了/異常時までを含む）。
エラーもHTTP statusとstream errorと不完全終了を分け、再試行しない。測定ログはtoken/本文を保存しない。

## ローカル実Browserの測定結果

Chromium 151.0.7922.34、2026-09-18 UTCに実行。[生の測定値](agent-stream-462-measurements.json)を保存する。単位は秒。AWS/CDNの性能を示す結果ではない。

| ケース | TTFB | TTFI / 正常完了 | 最大無通信 | 結果 |
| --- | ---: | ---: | ---: | --- |
| 即時 | 0.040 | 0.048 | 0.040 | 正常 |
| 35秒 | 0.013 | 35.008 | 10.002 | 正常 |
| 90秒 | 0.010 | 90.009 | 10.003 | 正常 |
| 180秒 | 0.007 | 180.008 | 10.004 | 正常 |
| 初期処理35秒・heartbeatあり | 10.005 | 36.006 | 10.005 | 正常 |
| 初期処理35秒・heartbeatなし | 35.050 | 36.043 | 35.050 | 正常 |
| 90秒無通信 | 0.009 | — | 45.001 | 45.010秒でidle abort |
| 途中error | 0.005 | — | 1.001 | 1.007秒でagent_failed |
| 利用者abort | 0.007 | — | 1.194 | 1.201秒で受信停止 |
| wire上のfinal欠落 | 0.008 | — | 0.008 | incomplete_stream |
| 実Server Agent＋fake model/weather | 0.005 | 0.023 | 0.016 | model 2回・Tool 1回 |
| buffered 35秒 | 35.008 | 35.015 | 35.008 | 正常 |

35秒のstreamは早く受信開始するが、有用な回答はbufferedと同じ約35秒後である。heartbeatによるTTFB改善をTTFI改善と呼ばない。
異常終了時の無通信計測と`settledMs`を追加後、短い異常系とheartbeatなし初期遅延だけ再測定した。90/180秒試験は繰り返していない。

## 再現

```bash
npm ci
npx vitest run backend/agent-api/src/agent-stream-poc backend/agent-api/src/adapters/agent-stream frontend/src/adapters/http/agent-stream
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROMIUM_EXECUTABLE=/path/to/chrome \
  node --import tsx tools/agent-transport/measure-browser.ts /tmp/agent-transport-browser.json
```

Browser測定はlocalhost HTTPで合成0/35/90/180秒、initial delay、無通信、途中error、abort、wire上のfinal欠落、実Server Agent＋fake model/weather、buffered比較を独立Browser contextで並行実行する。
日常の修正確認はvirtual timerを使い、長時間実Browser試験を毎回繰り返さない。`STREAM_CASES=stream:mid_error,stream:abort`で対象だけ再実行できる。
ローカルBrowser harnessだけは固定fake verifierを使う。JWTの署名/issuer/client/期限/token種別/scopeは隣接testで#484の実verifierと実行時生成鍵を使って検証する。

AWS用artifact・Terraformの確認手順と明示承認境界は[experiment README](../../infra/terraform/experiments/agent-stream/README.md)を参照する。

## 未実施・#480へ渡すgate

- Cognito付きAWSの30秒超Browser受信、CloudFront込みTTFB/TTFI/完了/idle、RESTとFunction URLの実測比較は **未実施**。localhost成功で代替しない。
- deployed設定、Regionalのstream対応、quota、実前段CDN/Cloudflare、cold start/JWKS、実Browser auth搬送、client切断後のAWS実行/課金、実モデル時間も未測定。
- #480で承認済みの非本番AWS環境にdeploy後、direct RegionalとCloudFront経路を同じscenarioで測る。Function URLを比較するならVPC外の独立PoCでIAM/OAC＋Cognito搬送を整備する。既存VPC Lambdaへinvoke modeだけ変更しない。
- 部分成功の再取得/再試行を導入する場合はrun IDの永続化とidempotencyを先に設計する。現PoCは切断したturnを再開しない。
- production切替は別PRで、#451認証UI・#479 State、Tool権限、fixed-IP Provider境界、公開routeの監視、旧route閉鎖とrollbackを含む。
