# #480 Production cutover 残条件と旧ingress閉鎖

2026-09-19、Issue本文を正本として `d5f65238637fc82c1eb8db56df5a4aebd729448f` のmainを棚卸しした。
#476の分担（#462 transport判断、#479 State、#480切替、#481最終削除）を維持する。
本変更はPR候補であり、merge/deploy・本番閉鎖完了を意味しない。

## 証拠と区別

- [CI / Test](https://github.com/ymho/transitforge/actions/runs/35430988933): 上記mainでSUCCESS。
- [Server Agent / Cutover Validation](https://github.com/ymho/transitforge/actions/runs/35430999670): SUCCESS。
  実Cognito PKCE、無token/不正token拒否、実Bedrock、宿泊Tool、固定IP Provider、保存、再送、競合、owner namespace分離がPASS。
  **35/90/180秒transportとTrip isolationはNOT RUN**。workflow全体のSUCCESSで代替しない。
- [production CD](https://github.com/ymho/transitforge/actions/runs/35431222311): 同mainでSUCCESS。
  GitHub dev Environmentの`SERVER_AGENT_ENABLED=true`をread-onlyで確認した。
  production BrowserのCognito login・複数turn成功は運用者の実確認報告による。今回再実行していない。
- 旧Lambdaの`get-function-url-config`は`AWS_IAM / BUFFERED`。
  `get-policy`の許可はViewer CloudFrontをSourceArnに限定したInvokeFunctionUrlと
  `InvokedViaFunctionUrl=true`のInvokeFunctionの2件。Principal `*`の公開許可はなかった。
  このOAC制限は利用者認証の代わりにはならない。
- Viewer CloudFrontの実設定で旧`/api/agent`と新`/api/agent-stream`の別origin、CachingDisabled、
  AllViewerExceptHostHeaderを確認。Server Agent LambdaはActiveでVpcConfigなし。

## #480受け入れ条件

DONEは上記main＋明示した実確認の範囲。候補コードの成功を本番反映済みと扱わない。

| Issue本文の項目 | 着手時 | 根拠 / 今回の扱い |
| --- | --- | --- |
| production Browserの1相談がServer Agentで完結 | DONE | production複数turn報告、Validationの実turn/保存PASS、`production-server-agent-composition.ts` |
| model/tool loop途中にBrowser往復しない | DONE | `runAgentTurn`とServer Tool組成。BrowserはIDs・入力・bounded UI contextを1 POSTする |
| #451と同じprincipal/authorization | DONE | `createCognitoAccessTokenVerifier`→`authenticatedApplication`、同pool/client/scope、owner namespace実AWS PASS |
| #462採用transportのtimeout/buffering/切断条件 | REMAINING | REST STREAMは稼働済み。35/90/180秒のAWS全経路測定はNOT RUN。ローカル合成試験で実AWSを代替しない |
| Trip/account切替でstream/遅着応答が混入しない | DONE（実装・offline E2E） | stream session世代、Abort、Chat世代、account/Trip切替のChromium E2E。実AWS Trip owner試験は別途NOT RUN |
| fixed-IP Providerがallowlist要件を維持 | DONE | 実Provider/宿泊turn PASS、既存NAT/EIPのidentity維持。今回ネットワーク差分なし |
| Server Agentを不要なVPCに入れない | DONE | Validation Lambda topology PASS、`agent-stream.tf`のVPC外組成。今回変更なし |
| 旧Browser Agentがproduction fallback/迂回路でない | REMAINING → 候補実装済み | gate ONの無言fallbackは既にないが、旧Lambdaのdefault model operationが到達可能だった。本PRで閉鎖。反映後の直接POST確認が必要 |
| rollback方法と旧経路閉鎖条件を記録 | REMAINING → 本文で記録 | 以下のrollback/閉鎖契約を正とする |

NOT APPLICABLE: Agent用Function URLを維持する案、async導入案、token-by-token配信。
採用済みREST progress/final streamingを変更しない。9件の受け入れ条件自体にN/Aはない。
既に実AWSで通ったモデル・State・Provider構成を再実装しない。

## `/api/agent` operation台帳

分類: A=旧Browser Agent専用、B=Server Agentへ移行済み、C=独立Browser機能、D=legacy/recheck、E=dead。
複数用途は併記する。「B」はBackend Usecase/Toolへ移ったという意味で、旧HTTP経由で実行する意味ではない。

| operation | 分類 / caller | 本変更後の旧HTTP契約 |
| --- | --- | --- |
| 未指定 / `bedrock_converse` / 未登録名 | A（未知名はE）: `invokeBedrockAgent` | 常に410。tokenやBrowser gateに依存しない |
| `agent_trace` | A: Browser Runtime | 410。内部Server TraceやStorage実装は削除しない |
| `conversation_feedback` | A: 旧会話全文feedback | 410。Server経路では既に送信停止 |
| `representative_timetable_search` | B: Server `search_representative_timetable` | Cognito必須の明示operationのみ維持 |
| `journey_search` | B/C: Server `search_journeys`、既存経路カード/検索handler | 同上 |
| `daily_congestion_analysis` | A: Browser分析Tool（Server未接続） | 同上。専門Tool移植や全削除はしない |
| `daily_congestion_peak` | E: exportのみ、production callerなし | 同上。dead export/operation削除は#481 |
| `train_delay_analysis` | A/D: Browser分析Tool、起動時recheck | 同上。recheckの仕組み全削除は#481 |
| `travel_accommodation_search` | B: Serverは専用固定IP Providerを使用 | 同上。旧Lambda/Secret/NATは変更しない |
| `weather_forecast_search` | B/D: Server Tool、Browser recheck | 公開readを維持。モデル・有料Provider・個人Stateなし |
| `weather_grid_search` | C: ログイン前を含む地図天気 | 公開readを維持。モデル・有料Provider・個人Stateなし |
| `place_media_search` | B: Server地点Tool | Cognito必須の明示operationのみ維持 |
| `place_detail_research` | C: 地図地点詳細の2つのUI入口 | Cognito必須。地点に束縛した編集用summarizerは維持。汎用conversationではない |
| `web_search` / `web_page_read` | B: Server Web Tool | Cognito必須の明示operationのみ維持 |
| `travel_alert_search` | B: Server公的防災Tool | 同上 |
| `ground_access_search` | B: Server徒歩・車Tool | 同上 |
| `restaurant_search` | B: Server飲食Tool | 同上 |

正本は`composition-root.ts`の登録、`legacy-agent-ingress.ts`の公開allowlist、Frontend HTTP Adapterと
`viewer-composition.ts`のcaller。未指定・未知名をdefault modelへ流すproduction組成を削除した。
明示operationにも`messages/toolDefinitions/modelClass/modelCallId`を混入させる要求は400。
汎用model/Tool loopの再入口にはならない。Server AgentのBedrock接続には触れない。

## 残すHTTP入口と認証

`/api/agent`の利用は0ではない。特にmap weatherとplace detailが残るため、URL/CloudFront origin/
behavior/OAC invoke許可を今回削除しない。専用routeへの移設も不要。`bedrock-agent` Lambdaは存続する。
旧origin/routeはコードとして残るが、汎用会話能力は閉じたままである。

残る保護operationは同じCognito Access Token/`raiquora/user`を業務実行前に検証する。
OACのSigV4 `Authorization`と競合しないよう、同originのJSON API clientだけが
`X-Raiquora-Access-Token: Bearer <access token>`を設定する。既存AllViewerExceptHostHeaderで転送する。
このheaderは**未検証のtoken搬送**であり、存在を認証済みidentityとは扱わない。body/headerのownerや
Gateway claimsは認可に使わない。署名・期限・pool・client・token_use・scopeは既存verifierのまま。
重複/矛盾/カンマ結合headerは拒否し、欠落/不正は401、scope不足は403。応答はno-store、tokenをlogへ出さない。
Basic認証とAWS_IAM/OACは維持する。Browserはcaller指定token、外部URL/query/redirectを拒否し、
account変更中のtoken待ち/受信/body読取を破棄する。認証エラーをHTTP自動retryしない。
`/api/agent-stream`は標準Authorization Bearerのままで変更しない。

## Infra差分と閉鎖条件

変更は旧`aws_lambda_function.bedrock_agent`のdescriptionと既存Cognito pool/clientの環境変数追加のみ。
コードbundle更新を除き、Server Agent/Provider Lambda、NAT/EIP/VPC/subnet、DynamoDB、Cognito resource、
Secret、CloudFront、Function URL、invoke permissionの設定差分はない。resourceの追加/削除/置換は意図しない。
既存destructive guardを変更せず、削除例外も追加しない。

将来URL全体を閉じる条件は、C/Dを含む残存callerの停止または認証済み移設と、直接利用を含む運用確認で
当該ingressのproduction利用が0と確認できること。その時だけ対象Function URL・behavior・origin・
invoke permissionのresource addressを特定してplanを審査する。Lambda本体を一緒に削除しない。
必要ならaddress限定の一時許可を別差分としてレビューし、他resourceのdelete/replaceへ広げない。

反映後は旧canonical `/api/agent`へ未指定・明示`bedrock_converse`・未知名をPOSTして410を確認する。
Basic/OACを通れない要求はその入口で401/403になってよい。valid Cognitoでも会話は410。
旧Function URL直アクセスはIAMなし403、保護operationはCognitoなし401/不正401/scope不足403。
Server Agentの認証済み相談、地図天気とログイン後地点詳細を確認する。旧会話を再有効化して試験しない。

## Rollback contract

- Server障害をBrowser Agentへ自動再送しない。既存turnIdの再送契約を維持する。
- 通常rollbackは本閉鎖を含むコードを基点にServer側の不具合だけを戻す。Cognito/State/Provider/ingress guardを保持する。
- 緊急停止は`SERVER_AGENT_ENABLED=false`でbuildした**本閉鎖以降の**Viewerを明示配信する。
  productionでは相談利用不可を表示し、旧Browser Runtimeを起動しない。infra側の2 gateはtrueのまま。
  本PRはEnvironment変更や配信を行わない。
- 閉鎖前のViewer/Lambda artifactや旧CD workflowを戻さない。Browser gate falseでも旧Lambda会話は410。
  header認証導入前のFrontendだけを戻すと有料独立機能が401になるため、対応する閉鎖済みartifactを組にして扱う。
- State/Trip/Secret/固定IPを保持し、新Server会話を旧LocalStorageへ移譲しない。
  旧会話経路の再開はrollback手順に含めない。

## #462 / #479 / #451のclose可否

#462は**close不可（候補保留）**。棚卸し、採用ADR 0070、不採用理由、再現手順、認証/途中失敗/切替の
offline検証は揃っている。一方「認証付き非本番全経路の30秒超を実Browserで確認」と
initial/idle/completionのAWS全経路測定は記録上未達。既存production成功を長時間fixture成功へ読み替えない。
新productionへsleep/scenarioを足したり、#480で検証環境を無断再構築したりしない。
旧経路迂回防止は本PRの反映確認後に更新できる。Issueは変更/closeしていない。

#479も**close不可（候補保留）**。条件ごとの根拠は次のとおり。

| 条件 | 評価 |
| --- | --- |
| principal別Conversation/Profile | DONE: 共通principal＋Dynamo owner key。会話は実AWS owner namespace不変性PASS、Profileはrepository署名fixture検証 |
| ServerでConversation/Profile/Trip復元 | DONE: `server-state-context-loader`、production State組成。Trip実AWS試験はNOT RUN |
| Browserから全文/Profile/Trip正本不要 | DONE: production turn DTOとunknown-field拒否 |
| uiFocus非永続 | DONE: bounded UI inputだけ、State write contractに入れない |
| logout/account/別tab/遅着 | DONE（offline契約）: session generation、tab独立認証、read/body fence、Chromium切替試験 |
| 会話削除でTripを削除しない | DONE（Application契約）: 会話repositoryだけの削除。公開削除endpointは未接続 |
| Profile更新でTripを更新しない | DONE（Application契約）: Profile repositoryだけの更新 |
| legacy救済要否、dual-writeなし | REMAINING: dual-writeなし。実端末データ救済要否は運用者確認が必要 |
| privacy/retention/key pattern | DONE（設計記録）: `server-state-persistence.md`。公開削除の継続実行・保持方針の運用確定を成功と混同しない |

#451を今回close候補とはしない。`lambda.ts`のTrip handlerはApplication/verifier未注入でpublic writerを
閉じている。「AがTripを2件保存し再読込後再取得」の実確認はない。Trip auth fixtureの成功と本番保存を
区別する。登録/メール確認/再設定/失効、Trip CAS/migration/quota等も既存Issue内で確認する。

## #481へ渡す残件

`viewer-agent-runtime.ts`大量削除、Frontend Bedrock bridge、dead/重複operation、LocalStorage legacy、
BrowserTravelRecheckRepositoryと起動時recheck、旧TripPlan/import、重複test/fixture、短命gateの撤去を送る。
README/product-brief/Architecture/AGENTSの全体監査も#481。今回変更した認証・閉鎖・rollback契約だけ更新する。
legacy救済は確認なしに「不要」と決めず、データを削除・自動uploadしない。

## 検証

旧会話の未指定/未知/明示operation、base64、許可operationへのmodel fields混入、valid/invalid JWT、
header重複、public weather維持、production compositionのrollback flag非依存をtargeted testで検証する。
Server streamの既存auth/保存/世代fenceとoffline Chromium E2E、build/typecheck、architecture、Lambda package、
Terraform fmt/validate/mock plan、既存destructive guardを確認する。root全量はPR CIに1回委ねる。
Prompt/Tool意思決定を変更しないため、既報のcutover品質確認を再実装せず、有料Live Evalは実行しない。
実AWS長時間試験、Trip isolation、本候補のdeploy後確認は上記どおり未完である。

### 候補の検証結果（2026-09-19）

- 旧ingress/auth/composition/HTTP Adapterのtargeted tests: PASS。Server stream/sessionの51 tests: PASS。
- Chromium 151のoffline production cutover E2E: PASS（実JWT verifier・保存fake・Provider fake・世代切替）。
- Backend typecheck/build、`VITE_SERVER_AGENT_ENABLED=true`のFrontend typecheck/build、architecture/workspace: PASS。
- Lambda package check: PASS。実production bundleの旧会話410・保護operation無token401も実行した。
- Terraform fmt/validate、既存mock plan 8 cases、既存deployment guard、関連Python infra 4 cases: PASS。
  validateには既存DynamoDB key属性のdeprecation warningがある。今回の目的外なので変更しない。
- 現行production state・CDと同じgate/入力によるread-only plan: PASS。`-lock=false`、backend lockfile無効、applyなし。
  **変更は`update aws_lambda_function.bedrock_agent`の1件だけ。全managed resourceのdelete/replaceは0件。**
  既存guard成功。生plan/secret/stateをログやPRへ載せず、actionだけを報告した。
- 専用npm format/lint scriptはない。`git diff --check`とTerraform fmtを使用した。
- root全量test/通常build/Agent SmokeはPR CIへ委ねる。本変更で意思決定/Promptを変更しないため、Full/Liveを追加実行しない。
- 未実施: merge/deploy後の本番閉鎖確認、AWS長時間transport、実AWS Trip isolation。PR作成までの依頼のためapply/deployしない。
