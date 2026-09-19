# Server Agent 実AWS cutover validation（#480）

`Server Agent / Cutover Validation`はdev EnvironmentとCDと同じ`AWS_DEPLOY_ROLE_ARN`の
OIDC sessionを使う手動専用workflow。GitHub Actionsでmainを選びmodeを指定する。
push/workflow_runでは実行せず、CDと同じ`transitforge-dev` concurrencyで直列化する。
**このPRはtraffic cutoverではなく、workflow自体も今回実行していない。**

## 使用方法

| mode | 実行範囲 |
| --- | --- |
| `verify`（既定） | gate、配置・認証・入口、専用Secret契約のread-only確認 |
| `migrate-secrets` | 配置確認、Secret分離、移行後契約確認 |
| `e2e` | verify、実Provider、一時ユーザー、PKCE、実Agent・保存・owner検証、cleanup |
| `all` | migration → contract → Provider → users/PKCE → E2E → cleanup |

Environment変数は`AGENT_STREAM_ENABLED=true`、`FIXED_EGRESS_PROVIDER_ENABLED=true`、
`SERVER_AGENT_ENABLED=false`を全て明示する。main以外、欠落、矛盾、Browser ONは拒否する。
初回の空Secretに対するverifyはFAIL。初期化は人がmigrate-secretsまたはallを選ぶ。
実AWSの配置と実値は今回未確認であり、実行時のread-only discoveryで検査する。

他のSecret writerとIAMによるProvider検証呼出しを停止して実行する。
GitHub concurrencyは手元CLIや別repositoryをロックしない。Secrets Managerに条件付きPut/CASは
ないため、preflightと書込み直前の再読取りの間の外部writer競合まで原子的には防止できない。

AWS discoveryはidentity、Lambda topology、secret wiring、public ingress absence、API Gateway route、
API Gateway streaming、CloudFront route、Lambda permission、IAM Provider invoke、Cognito OAuthの
固定checkpointへ分割する。失敗したcheckpoint以降は実行せず、remote valueや例外本文を含めずに
固定labelとPASS/FAIL/NOT RUNだけを表示する。

unauthenticated/invalid tokenの両origin検査はGatewayのburstを消費するため、各requestの間と最初の
認証済みturnの前に1 token intervalを待つ。この待機はE2E harnessだけにあり、Gateway設定やproduction
trafficを変更しない。429をretryや許容で隠さず、validation自身がproductionのrate limitを尊重する。

## Secret split

入力は`/transitforge/dev/travel-provider`。旧Secretにはreadのみを行い、変更・削除しない。

| 移行先 | 許可するキー |
| --- | --- |
| `/transitforge/dev/fixed-egress-travel-provider` | 必須`application_id`、`access_key`、`hotel_search_url`、任意`vacant_hotel_search_url`、`affiliate_id` |
| `transitforge-dev-agent-stream-providers` | 任意`mapbox_search_access_token`、`brave_search_api_key`、`hot_pepper_api_key`のみ |

名称はdev Terraform命名を明示的に固定し、Lambda環境変数のARNとも照合する。
未知キーを移さず、専用Secretの未知キー・混在・空文字・非stringを拒否する。
旅行URLはHTTPSかつuserinfoなしを確認する。non-travel未設定なら`{}`を許可する。

既存の器がありversionが無い場合だけ初期化する。器の不存在、AccessDenied、壊れたJSON、
AWSCURRENT不在は空扱いにしない。両移行先を先に検査し、生成するJSONと既存値が一致すれば
no-op、不一致なら固定エラーで停止する。片方のみ書込み後の失敗も再実行できる。
JSONのキー順には依存しない。値・差分・VersionIdは出力しない。

## 実呼出しと証拠

Provider名はSTS accountとTerraform命名、Server Lambdaの参照ARNを突き合わせる。
既存typed parserを使い、実行日+45/+46日の京都・大人1人・最大2件をRequestResponse、
LogType None、retryなしでInvokeする。FunctionError、非成功DTO、不正DTO、timeoutはFAIL。
空候補の正常応答は成功とする。単体Invokeは35秒で打ち切る。

一時ユーザー2名をランダムUUIDの`cutover-…@example.invalid`で作成し、メール送信を抑止する。
強いランダムpasswordをメモリに保持し、**今回作成したユーザーだけ**にAdminSetUserPasswordで
恒久passwordを設定する。隔離Playwright/Chromium contextでManaged Loginを操作し、
Authorization Code + S256 PKCE、`openid email raiquora/user`を使う。
ADR 0069どおり既存`oidc-client-ts`でPKCE/state/nonce生成・一度限りのcode交換を行い、stateはメモリだけに置く。
既存`https://app.ohmyki.com/index.html` callbackをBrowser内でinterceptし、Viewerへcodeを送る前に
token endpointで交換する。state/URL/重複parameterを検証し、既存production Cognito verifierで
Access Tokenとownerを検証する。ID TokenをAPIへ送らず、direct password authを追加しない。

実streamは同一origin Browser fetchから`https://app.ohmyki.com/api/agent-stream`へ送る。
harnessの空documentだけをローカルinterceptし、Viewerをdeployしない。
Cloudflare → CloudFront → Regional REST → Lambdaを通す。AWSからCloudFront alias、origin、
cache無効、Authorization転送policy、圧縮無効、scope付きRegional RESTを照合する。
canonical経路とdirect execute-apiでtokenなし・無効tokenの401/403を確認する。
Backend verifierの通過は正常な実Agent turnで確認する。

単純会話、保存済みfinalの再送、異なる入力のturn_conflict、Bの正常control turn、
AのIDへのBの継続試行、明示日程の宿泊検索を検証する。owner検証失敗は記録して宿泊検証まで
継続し、最後にrun全体を失敗とする。requestはUUIDと入力・必要な参照だけで、history/profile/
principal/toolsを送らない。各Browser requestはidle 45秒・全体150秒、production business
deadlineは120秒のまま。新規Agent turnは最大4件、ほかにreplay/conflict試行がある。
5分のAccess Token寿命を考慮し、owner検証と宿泊検証前はPKCEで取り直す。

既存stream consumerでprogress/final/done/EOF、連番、サイズ、未知field、途中切断を検証する。
内部Trace/Tool/credential fieldと既知の内部markupも拒否し、本文は公開しない。
TTFB/completion/最大無通信時間はメモリで測定し、SummaryはPASS/FAILだけを出す。
DynamoDBは既存owner/key契約のstrongly consistent GetItemでowner・completed receipt・final保存を
検査する。replayはfinal一致に加えConversation revision・receipt・attemptIdを含む保存内容の
不変性を検査する。model/tool無再実行の契約は既存offline cutover testでも確認する。

宿泊turnは正常finalと保存に加え、開始〜終了の時間窓内に専用Provider LambdaのSTARTが
発生したことを確認する。CloudWatch配送待ちは最大6回・間隔10秒で、Agentは再実行しない。
Provider本文やTraceをログへ追加しない。**これは時刻による補強証拠であり、同時に別IAM callerが
呼び出した場合のrequest単位の相関証明ではない。** 外部invokerが静止している前提で使う。

## 既知のcutover blockerとNOT RUN

現行`createProductionConversationAgent`はowner namespaceにないconversationIdを新規作成する。
BがAと同じIDを送ってもAのstateを読む設計ではないが、Bの別会話を作ってmodelを実行できる。
今回指定された**他ownerのID継続を403/404で拒否しBのstateを作らないgateは、現行mainでは満たさない**。
workflowはこれをPASSへ読み替えず`owner isolation: FAIL`とする。Bの正常turnも先に行い、
期限切れや全API拒否をowner拒否と誤認しない。production所有権設計はこの検証PRでは変更しない。
#480のcutover判断前に契約を解決する必要がある。

- **35/90/180 real AWS transportだけ未実施**。既存experimentは独立state、scenarioをLambda環境へ
  設定するdeployと専用CDN経路の準備が必要で、許可されたmutationだけでは再利用できない。
  SummaryはNOT RUN。productionにscenario/sleep/test-only delayを追加しない。
- Trip isolationはNOT RUN。production `lambda.ts`は`createTripApiHandler()`へApplication/verifierを
  注入しておらず、安全なpublic create routeがない。検証用APIは追加しない。
- Function URL不在、Provider resource policy不在、Gateway限定Server resource policy、Server roleの
  専用Provider Invoke grantを検査する。アカウント全IAM principalの権限を列挙して唯一のcallerを
  証明する監査ではない。検証OIDC session自体も単体Invokeの例外callerとなる。
- 旧`/api/agent`は変更しない。origin閉鎖とBrowser traffic切替は後続作業。

## Mutation・cleanup・非開示

OIDC inline session policyで既存deploy roleを制限し、設定変更/deploy権限を与えない。
mutationは専用2 SecretへのPutSecretValue、一時ユーザーCreate/SetPassword/Delete、通常の
認証済みE2EによるApplication state作成、単体Providerのread-only検索Invokeに限定する。
IAMでCognito user単位の制限はできないため、helperで今回のPool・名前を照合する。
Terraform/state、CloudFront、S3、gate、旧Secret、旧route、Cognito設定、NAT/EIP/VPCは変更しない。
session権限は元deploy roleとの積集合であり、元roleに権限がなければFAILする。

一時ユーザー作成意図は応答が失われてもcleanupできるよう事前に0600 ledgerへ記録する。
password/tokenは記録しない。finallyと`if: always()`の別stepで、今回の名前・Pool・email属性・
作成時刻を再照合して削除する。片方が失敗しても他方を試し、残りだけを再試行する。
作成前に既存ユーザーが見つかれば変更しない。umask 077、最終cleanupのshell EXIT trapでledgerを
削除しartifactへ残さない。runner喪失・job強制終了・AWS障害時は削除を保証できない。
その場合は運用者がCognitoの`cutover-` prefix、run時間、`example.invalid`を照合して調査する。
既存ユーザーの一括削除やprefix scanによる自動削除は行わない。

Conversation削除public APIは未接続なので直接DynamoDB Delete権限を追加しない。
テストstateはランダムUUID、一時owner、`E2E cutover validation:` title/inputで識別して残す。
TTL削除は保証しない。Secretはrollback元も含め保持する。

AWS CLIはshellを介さず、0700の一時ディレクトリ内に0600で排他的に作成した入力JSONを
`--cli-input-json file://<path>`へ渡し、stdout/stderrをメモリで捕捉する。入力値はargvへ含めない。
入力のないSTS GetCallerIdentityはJSONファイルを作らず、明示的な`{}`はJSON入力として扱う。
成功、CLI失敗、spawn失敗、timeout、応答上限超過、JSON解析失敗のいずれもfinallyで一時入力を削除する。
プロセス強制終了やrunner喪失時の削除は保証できないため、隔離された一時runnerで実行する。
ローカルdevのread-only比較では通常引数と一時ファイルが成功し、`file:///dev/stdin`だけが失敗したため、
stdin transportを使用しない。実AWSの応答本文とstderrは記録・公開せず終了コードだけで比較する。
例外・response・token・claims・user名・検索結果・モデル本文をlog/summary/artifactへ流さない。
固定ラベルとPASS/FAIL/NOT RUNだけを出し、Playwright trace/HAR/screenshot/console転送は使わない。
startup/browser例外のstderrもwrapperで破棄し、set -xを使わない。
SummaryのBrowser gate PASSは受け取ったEnvironment変数の再検査であり、他の運用者による
実行中のGitHub Environment編集を監視するものではない。

## Offline検証

```bash
node --import tsx --test tools/cutover-validation/*.test.mjs tools/cutover-validation/*.test.ts
node --test tools/deployment/*.test.mjs
bash -n tools/cutover-validation/run.sh
actionlint .github/workflows/server-agent-cutover-validation.yml .github/workflows/ci.yml
npm run test:agent-cutover:browser
npm run architecture:check
npm test
npm run build
npm run lambda:check
python3 -m unittest discover -s tests -v
```

helper testはsynthetic値のみで、AWS/Provider/Cognitoへ接続しない。migrationのno-op/拒否/途中失敗、
非開示、PKCE/callback/token、厳密cleanup、配置検査、production parserを検証する。
専用format/lint scriptはなく、shell構文、actionlint、architecture check、git diff --checkを使う。
実AWS E2Eと35/90/180秒の成否はoffline成功から推測しない。

一次資料: [Cognito authorization/PKCE](https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html)、
[Managed Login](https://docs.aws.amazon.com/cognito/latest/developerguide/login-endpoint.html)、
[PutSecretValueのversion/idempotency](https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_PutSecretValue.html)。
