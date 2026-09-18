# ADR 0070: Server Agentの通信にRegional REST progress streamingを採用する

- ステータス: Accepted（production切替は実AWS検証gate通過後）
- 日付: 2026-09-18
- 関連: #462 #476 #478 #480、ADR 0019 0067 0068

## 決定

#480の採用案を **Browser POST/fetch → CloudFront → Regional REST API（AWS_PROXY/STREAM）→ Lambda → 1 Server Agent run** とする。
最初は安全なprogress/heartbeatとGrounding済みfinalだけをstreamし、token-by-token生成とは分ける。
HTTP/SSEをRuntime coreへ入れず、Server Applicationのevent sinkと外側のtransport adapterで扱う。
今回productionへ配線せず、AWSリソース作成/deployも行わない。

この判断は公式仕様、ローカルBrowser測定、offline認証/構成検証に基づく設計選択である。
**Cognito付きAWS/CDN全経路の30秒超受信・buffering・timeoutのACは未達であり、localhost成功で代替しない。**
実AWSで同じ尺度のgateが通るまでproduction採用を有効化しない。

## 比較

| 観点 | A: CloudFront→IAM Function URL | B: CloudFront→Regional REST STREAM（採用） | C: 必要処理だけasync |
| --- | --- | --- | --- |
| 利用者認証 | OAC SigV4とは別にCognito verifier。Authorization搬送の分離が必要 | Cognito User Pool Authorizer＋OAuth scope、Backendで既存verifier/client/all-of scopeを確認 | submit/status/result各APIの認証・owner管理が必要 |
| streaming | VPC外ならRESPONSE_STREAMで候補になる。現行VPC/BUFFEREDの変更だけでは不可 | AWS_PROXY/STREAMとstreaming invoke URI。HTTP APIとは別 | 通知/poll等がさらに必要 |
| timeout | Lambda/CloudFront双方。接続切断はLambda停止の保証にならない | RESTは最大15分、Regional idle5分。ただしCloudFrontとBrowserは別上限 | 接続寿命を越えて継続可能だがretry/state/idempotencyが必要 |
| CloudFront/buffering | 既存cache無効を維持し、圧縮・認証搬送・timeoutを変更して実測する必要 | 本PoCはcache/圧縮無効、read60秒/completion260秒。全経路は未測定 | 長い接続不要。ただし状態取得遅延がある |
| 実装量・運用 | resource追加は少ないが独自auth搬送・route制御が増える | API/stage/authorizerの追加。scope/throttling/metricsを境界に置ける | queue/worker/store/運用を追加する負担が最大 |
| 料金 | Gateway request料金なし。Lambda duration/streaming/CloudFront転送等は残る | REST request＋転送が追加。小さなprogress/finalはpayloadが小さく、モデル/実行時間も比較する | queue/storage/worker/通知の追加費用 |
| observability | Lambda/ApplicationとCloudFrontで関連付ける | 上記＋Gateway。PoCではbody data trace無効、productionはsafe access log項目を設計する | run/job状態・retry・滞留の監視が必要 |
| Browser変更 | POST/fetch stream consumerが必要 | 同左。既存JSON自動retryは移植しない | submit後の状態・再取得UIが必要 |
| 旧経路閉鎖 | 同じURLの切替は小さいがlegacy operationも閉じる必要 | 新入口の認証E2E後に旧Function URL/Browser bridgeを閉じる段階が明確 | 同左に加えて旧job lifecycleを管理 |

Aは継続候補として残せるが、#451の認証境界・route/scope・運用をGatewayへ寄せるBを優先する。
「AIは長いからFunction URLしかない」という理由はREST streaming仕様で成立しない。
固定IP Providerの都合でAgent Runtime全体をVPCへ固定し、A/Bを選ぶこともしない。

HTTP APIは最大30秒でstreaming非対応のため、この長時間turnには使わない。
通常CRUDは今回変更せず、共通RESTへ寄せるか別HTTP APIにするかはState/route移行時に判断する。
画面離脱後の継続・結果再取得・durable retryの要件が今回の対話turnにはないためCは導入しない。
これらが必要な特定処理が現れたら、その処理だけ後続Issueにする。SQS/Step Functions/ECSを先行追加しない。

## 測定と制約

一次資料、現在経路の棚卸し、再現手順、結果の詳細は[検証記録](../experiments/agent-stream-462.md)に集約する。
2026-09-18、Chromium 151のlocalhost実受信では、35秒streamのTTFBは約13ms、TTFI/completionは約35.008秒。
同じ35秒のbuffered fixtureはTTFB約35.008秒、TTFI/completion約35.015秒だった。
90秒streamは約90.009秒、180秒streamは約180.008秒で完了し、最大無通信は約10.004秒だった。
これはCloudFront/REST/Function URLのAWS実測値ではない。heartbeat/runningをTTFIに数えず、有用回答の時間は改善したと主張しない。

PoC案はLambda240秒、Gateway250秒、CloudFront read60秒/completion260秒、Browser idle45秒/deadline270秒。
10秒heartbeatは認証完了後のみ。cold start/JWKS/Authorizer遅延は最初の待ち時間へ含まれる。
前段CDN/Cloudflare等がある場合のbuffering/timeoutは未検証。Gatewayの最大15分だけを全経路の保証にしない。

## 認証と公開event

#484の`AccessTokenVerifier`/`TrustedPrincipal`/`authenticatedApplication`を再利用する。
Gatewayは同じUser Poolと`raiquora/user` scopeを要求する。scopeを省略しID Tokenを許容する設定にしない。
BackendはBearerを同じverifierで検証し、署名/期限/issuer/client/token_useと必要scope全件を確認してからAgentを呼ぶ。
Gateway claims・body principalを信用せず、二つ目のJWT検証実装は作らない。
expired、wrong issuer/client、ID Token、scope不足はmodel/Tool前に拒否する。tokenはquery/logへ出さない。

Application eventは固定progress、検証済みfinal response、公開可能なerror codeだけ。
内部推論・raw Tool・Provider response・Trace・未検証事実は途中へ出さない。
SSEは連番/run ID/サイズを検査し、UTF-8/chunk分割・複数frame同着を扱う。
HTTP200後のerror、done欠落、partial frame、EOFだけを成功としない。
account/conversation/tripのgeneration変更後はcallbackを破棄し、呼出側は同時にAbortControllerも解除する。

## 切断と再検討

Browser abortは受信停止/遅着反映防止であり、Lambda/model停止・課金停止を保証しない。
PoC adapterは観測可能な切断後のwriteを止めるが、既存Server Runtimeへキャンセルを逆流させない。
AWSではCDN/Gatewayが切断をLambdaへ即座に伝えない可能性もある。期限によるbounded executionを維持する。
部分成功の自動retry/reconnectは行わず、再取得が必要ならdurable run/idempotency設計を先に追加する。

#480のgate: 実Cognito token＋CloudFront全経路の35/90/180秒、initial/idle/completion、エラー/切断、
production Server Tool/State、origin迂回、旧URL閉鎖とrollbackを検証する。
#451 Phase2のCognito UI/Terraformや#479 StateをこのPoCで重複実装しない。
ADR 0019のfixed-IPはTool Portの先へ維持し、専用Provider配置は#480が所有する。

実AWSで逐次受信しない、認証搬送が成立しない、実アカウントquota/timeoutが不足する、RESTの費用や
運用負担が許容できない場合はAへ再評価する。接続を越えた継続/再取得が要件化した場合はCを評価する。
