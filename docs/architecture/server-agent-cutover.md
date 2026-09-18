# Server Agent production cutover-ready統合（#480）

最新mainの#478/#489/#490/#491/#492/#493を接続する。AWSへのapply/deploy、Cognitoユーザー作成、
Provider allowlist変更、実traffic切替は行っていない。#480は実AWS検証・切替までOpenとする。
[ADR 0068](../decisions/0068-place-agent-runtime-in-server-application.md)、
[0070](../decisions/0070-select-regional-rest-agent-streaming.md)、
[0071](../decisions/0071-isolate-fixed-egress-provider.md)を変更せず参照する。

## Targetと実行所有者

Browser（表示・入力）→ Cognito Access Token → CloudFront → Regional REST STREAM →
既存AccessTokenVerifier → TrustedPrincipal → Conversation初期化 → beginTurn →
Conversation/Profile/Trip復元 → MultiStepAgentRuntime → Server Tool → completeTurn → final/done → Chat表示。

`agent-stream-lambda.ts`が`createProductionServerAgent`を認証後に作成する。
`createProductionConversationAgent`は新規UUIDをowner namespace内の空の会話として作成する。
同時初期化は既存conditional createで解決し、削除済みtombstoneは復活させない。
既存会話にはLocalStorageの本文・summary・Profileを移入しない。
`createConversationServerAgent`と`createStatefulServerAgent`が#492/#489の保存と復元を所有する。
Browserはmodel/tool loopを呼ばず、失敗してもBrowser Runtimeを呼ばない。

## Requestと保存

```ts
{ conversationId: string, turnId: string, userRequest: string,
  tripId?: string, uiContext?: { itemId?: string } }
```

conversationId/turnId/tripIdはUUID。userRequestは8,000文字以内、itemIdは200文字以内。
未知キー、history、Profile本文、Trip本文、Tool定義・結果、Bedrock messages、principalは拒否する。
TokenはAuthorization: Bearerだけに載せる。Gatewayは既存Cognito poolとrequired scope、Backendは
同じverifierでissuer/client/token_use/期限/必要scopeを検査する。401/403はApplication作成より前で、
State read/writeもmodel/Toolも始めない。401はWWW-Authenticate: Bearerとno-storeを付ける。

1 user actionで1 turnIdを生成する。`createConversationStreamSession.start()`の返すactionを
明示的に再送する場合は`send()`を再使用し、同じrequest/turnIdを使う。自動HTTP retry/reconnectはしない。
新しい送信操作は新turnId。同一IDで入力が違えば`turn_conflict`となる。
stream開始後なのでHTTP200 + error eventで表現し、409 HTTP retryと混同しない。
completed retryは保存済みfinalを返し、Context/model/Toolを再実行しない。
progressは保存しない。保存完了が不確実な場合はfinalを送らず、既存receiptで再送を解決する。

公開eventは固定running progress、保存済みfinal text、公開error codeだけ。
raw Evidence、Tool出力、内部推論、Traceは送信しない。受信側はfinalとdoneとEOFまで確認してから
既存Chatの安全なMarkdown表示へ渡す。finalだけ、doneだけ、連番欠落、途中切断は成功扱いしない。

## Browser lifecycle

auth/account・conversation・trip・request/turnを別世代で管理する。
認証通知、会話切替、Trip ID/revision切替、新turnでAbortControllerを解除し、token待ち・本文待ち・
callback時にも世代を確認する。古い401で新しいaccountを失効させない。
Chat自身もrequest世代を持ち、切替前のpromiseで新しいpending表示や入力状態を変更しない。
abortは受信停止だけであり、Lambda/Bedrock停止や課金停止の保証ではない。

gate ONの会話一覧・表示履歴はメモリ内のUI cacheを使い、account変更で破棄して新UUIDへ切り替える。
サーバ保存がContextの正本。現段階の一覧はtab内のみで、再読込後の過去会話一覧取得UIは含まない。
既存LocalStorageの会話/Profile/旅程は削除しないが、Agent requestへ送らない。
旧feedback APIへの会話全文送信も新経路では無効にする。

## Tool inventory

Browserの正本は`viewerAgentToolNames`、`externalTravelToolNames`と条件付きTrip V2 tool群。
Serverの登録正本は`productionServerTools`＋既存weather binding。

| 用途 / Browser能力 | Server接続 | descriptor / operation / Evidence |
| --- | --- | --- |
| weather | search_weather_forecast | 既存weather descriptor / WeatherForecastOperation / externalTravelEvidence |
| Web検索・ページ読取 | search_web / read_web_pages | 共有external-travel-tools / 既存Web Usecase / externalTravelEvidence |
| 地点発見・照合 | search_place_media / resolve_place_candidates | 共有external-travel-toolsの実行も再利用 / 既存PlaceMediaSearch / externalTravelEvidence |
| 防災情報 | search_travel_alerts | 同上 / HazardAlertSearch / externalTravelEvidence |
| 徒歩・車・飲食店 | search_ground_access / search_restaurants | 同上 / GroundAccessSearch・RestaurantSearch / externalTravelEvidence |
| 宿泊 | search_accommodations | 既存input schemaを共有化 / AccommodationSearch → LambdaAccommodationProvider / externalTravelEvidenceのoffering projection |
| 鉄道経路 | search_journeys | 既存SearchJourneysTool descriptor / JourneySearchOperation / 既存evidenceFromJourneySearchを共有化 |
| 代表ダイヤ・列車案内 | search_representative_timetable | 共通descriptor / 既存RepresentativeTimetableOperation / 共通代表ダイヤEvidence |

宿泊結果は候補の存在と空室確認状態を分離してGroundingする。未知の料金は作らない。
経路は既存Backendの日付別index、代表ダイヤは既存S3Repositoryを再利用する。
外部調査の状態・Tool/Evidence Registryはturnごとに作成する。
地点IDの照合やWeb出典の束縛は既存の決定論的処理を再利用し、BrowserのTool結果を信用しない。

`search_direct_routes`相当の駅間検索は`search_journeys`で提供する。
Browserの表示中index検索、直前カード編集、legacy TravelPlan合成（plan_day_trip等）、端末内
remember_travel_preference/update_conversation_session/schedule_trip_recheckは移植しない。
日付別の駅間検索・代表ダイヤ検索と、サーバ履歴を用いた通常の追加相談へ統合する。
履歴分析・inspect系の専門Tool、およびTrip V2の候補採用・準備リスト・予約・変更案表示Toolは
このread-oriented text final経路には未接続。自動変更・採用・予約をしたと答えない。
この統合は既存Browserの構造化カード/編集能力との全機能同等を意味しない。
実traffic切替の判断ではこのinventoryと実利用シナリオを確認する。

## Infraと固定IP

Agent LambdaはVPC外。Server State表に既存policy、Trip表にGetItem、鉄道入力に限定S3 GetObject、
専用non-travel SecretにGetSecretValue、専用Provider LambdaにInvokeFunctionだけを追加する。
non-travel Secretは既存Mapbox/Brave/HotPepper credential schemaを用い、宿泊credentialを入れない。
旧mixed Secretと宿泊専用SecretをAgent roleへ付与しない。Secret値はTerraformへ置かない。

宿泊Tool → 既存AccommodationProvider Port → IAM同期Invoke（SDK retryなし）→ VPC Provider Lambda →
既存private subnet/NAT instance/EIP → Provider。AgentへTravel credentialsを持たせない。
Agent streaming構成の有効化には`enable_fixed_egress_provider=true`を必須とする。
既存NAT/EIPのresource identityとallowlistは変更していない。

## 短命gate、閉鎖とrollback

`VITE_SERVER_AGENT_ENABLED=false`がBrowser既定値。
OFFは現在のBrowser Agent。trueでbuildすると全相談がServer streamへ入り、dual executionも
Server障害時のBrowser Agent fallbackもない。`agent_stream_enabled`と`enable_fixed_egress_provider`は
その前段のinfra準備gateで、既定falseを維持する。今回CI/CDやtfvarsで有効にしない。
Browser build gateは配信時に固定され、通信エラーで自動変更しない。
#480の実AWS確認・traffic切替後、#481の旧コード削除と合わせてgate自体を撤去する。恒久flagではない。

実切替前にCognito実token、direct execute-api認証、CloudFront/前段CDN経由35/90/180秒、timeout、
buffering、Provider allowlist、IAM/Secret、保存競合、account切替を確認する。
切替時に旧Browser model-call APIのrouting/default fallbackを無効化し、旧Function URL・invoke許可・
CloudFront旧behaviorを閉鎖する。未認証の迂回経路を残さない。
旧APIを使う地図専用Provider read等も棚卸しし、必要なら認証済み専用routeへ移してからURLを閉じる。
今回旧Function URLを削除しない。

rollbackは運用判断による旧Viewer artifactへの明示的な復帰とroute設定の復元で行う。
Server Stateは保持する。新Server turnを旧Browserへ自動再実行せず、異なる保存正本を混ぜない。
旧route閉鎖後のrollbackには認証の迂回を再開しない構成レビューが必要。

#481へ渡す削除候補: Browser Runtime組成、Bedrock HTTP message bridge、旧Tool/legacy TravelPlan adapter、
LocalStorage Conversation/Profile writer、旧feedback/trace経路、短命Browser gate。
#480の実AWS切替で閉じるもの: 旧model-call公開routing、Function URL、invoke権限、旧CDN behavior、
未認証route、infra準備gateの役目。コード削除とinfra閉鎖を混同しない。

LocalStorage救済対象の有無は**要手動確認**。開発者中心の運用記述だけでは実端末内データの存在を
判定できない。migrationを自動作成・実行しない。不要と確認できたものを#481で削除する。

## Offline検証

root test/build、architecture/workspace、Python infra契約、Terraform fmt/validate/mock test、Lambda package、
Agent Smoke/Fullをcandidate完成時に実行する。format/lintのnpm scriptは存在しない。

```bash
npm run test:agent-cutover:browser
```

Playwrightをrepo外へ導入し、`PLAYWRIGHT_MODULE`でindex.mjsを指定できる。
インストール済みChromiumを使う場合は`PLAYWRIGHT_EXECUTABLE_PATH`を指定する。
実Browser → HTTP → 実JWT verifier（local JWKS）→ Dynamo command fake → Context → 実Runtime →
fixed-egress Invoke fake → 保存 → stream → 既存Chat presentationを通す。
Profileなし/Tripあり、completed retry、conflict、401/403、logout/account/conversation/trip/new turn、
final欠落、Tool/stream errorを確認する。これはAWS/CDN経路・実Bedrock品質・画面全体のE2Eを代替しない。
Live Eval、有料Bedrock、実AWS E2E、apply/deployは今回未実施とする。

## Preflight blockerの修正と次のgate（#480）

2026-09-19の`aws-cutover-preflight-480.md`を基点に、実AWSへ進む前のコード/CD blockerを修正した。
AWS構成、Secret値、allowlist、GitHub Environmentの値、trafficはこの修正では変更しない。

Browser cutover E2Eの失敗はtest HTTP serverがfavicon等の空bodyまで本番handlerより先に
`JSON.parse`したためだった。本番handlerのroute/auth/input検証へそのまま渡し、HTTP200の
検証済みrequestだけを検査用に記録する。未知routeは404、認証済みの空/不完全JSONは400の
`request_failed`になる。Nodeのrequest callbackのPromiseは明示的に監視し、想定外の例外は
安全な500または接続切断にして、収集した例外が0件であることをテスト終了時にassertする。
例外を捨ててexit 0にせず、401/403、final欠落、stream error、abort/世代変更の検査を維持する。
Browser consumerの空EOF/不正SSE/error responseも既存の公開errorへ変換されることを確認する。

### Server Agent business deadline

Streaming production compositionは`SERVER_AGENT_MAX_EXECUTION_MS`を必須とし、整数
1,000〜180,000msだけを受け付ける。未設定・不正値は構成エラーとして失敗させ、共有Runtimeの
15秒へ暗黙fallbackしない。Terraform `server_agent_max_execution_ms`の既定・推奨は120,000ms。
この変数はstream Lambdaだけへ渡し、共有Runtime/旧Browser/default-off経路の既定値は変えない。

120秒は複数model/Tool呼出しの余裕を取りつつ、Lambda240秒まで120秒を残す初期値である。
上限180秒でも60秒を残し、Runtimeの前後にあるJWT/Context/turn保存・終了処理に余裕を持たせる。
これは実測済み性能SLOではなく、実AWS E2Eで調整するboundedな初期契約である。Runtime計測は
context復元後のmodel/tool loopを対象とし、認証・State通信を含む全requestの時間保証ではない。
Lambda240秒、Gateway250秒、CloudFront completion260秒、Browser deadline270秒はtransportの
別契約であり変更しない。35/90/180秒のtransport耐久fixtureはこのbusiness deadlineとは分ける。
180秒のfixture成功を、実Agentが180秒まで正常完了する保証として扱わない。

deadline超過は既存Runtimeの`limit_reached`→Conversation turnの失敗→streamの`agent_failed`
＋doneのまま。completed/finalを保存・送信せず、モデルの自動再実行やBrowser fallbackを追加しない。
下位Provider/Lambdaの遠隔処理停止を保証しないため、Tool回数上限と個別timeoutも維持する。

### CDのgate入力と削除防止

GitHub `dev` Environmentに次の3変数を**全て明示**する。設定可能な値は小文字`true`/`false`だけ。
未設定をfalseへ補完せず、AWS認証より前に停止する。初期値は全て明示的な`false`で準備する。
TerraformとBrowserコード自体のdefault-offは維持する。

| Environment Variable | CDへの入力 |
| --- | --- |
| `AGENT_STREAM_ENABLED` | `TF_VAR_agent_stream_enabled` |
| `FIXED_EGRESS_PROVIDER_ENABLED` | `TF_VAR_enable_fixed_egress_provider` |
| `SERVER_AGENT_ENABLED` | `VITE_SERVER_AGENT_ENABLED`（同じjobのFrontend build） |

許可する組合せは`stream/provider/browser`の順に`false/false/false`、`false/true/false`
（Provider先行準備）、`true/true/false`（infra/E2E準備）、`true/true/true`だけ。
Browser ON/stream OFF、stream ON/Provider OFFを拒否する。Browser gateはbuild時固定である。

plan後の`tools/deployment/cutover-gates.mjs`は実planのgate値が検証済み入力と一致するか確認し、
既存stream/Provider resourceがあるのに対応gateがfalseなら停止する。さらにcutover専用resourceの
**deleteを含むaction（replaceを含む）を原則拒否**する。固定送信元IPの共有基盤
（`ai_egress` / `ai_nat`）も削除・replaceを拒否する。
唯一の例外はstream gateがtrueで、typeが`aws_api_gateway_deployment`、nameが`agent_stream`、
addressが`aws_api_gateway_deployment.agent_stream["stream"]`、actionsが厳密に`["create", "delete"]`の場合だけ。
immutableな構成snapshotのcreate-before-destroyによる世代交代を許可する。delete-onlyや
`["delete", "create"]`は拒否し、他のLambda/API/Secret/IAM等には例外を適用しない。
summaryはこのrotationもaction/addressだけを表示し、値・ARN・before/afterは出さない。明示falseへの誤変更も防ぎ、
部分作成済みのIAM/Secret等も検出する。通常CDに削除を許可するoverrideは置かない。
resource移設・廃止や意図的なreplaceは別のレビュー対象とする。BrowserだけのOFFはinfraを保持できる。

変更前CDはgateを渡さないため、初回ON前に本workflowがmainの正本であることを確認する。
旧revisionのworkflow再実行には新guardが存在しないため使わない。旧route閉鎖後のBrowser OFFは
認証迂回を再開しない構成レビューを別途要する。guardは旧route再公開の承認を代替しない。

### 本番入力のplan-only

`CD / Deploy`のmainに対するworkflow_dispatchは`mode=plan`が既定で、既存Environment/Secretsを
使いbuildとplan/guardだけを実行する。Terraform apply、S3同期、invalidationは`mode=deploy`でのみ
実行する。CI成功による従来の自動CDはdeploy modeだが、同じ必須gateと削除guardを必ず通る。
plan-onlyも同じconcurrency groupで直列化し、進行中deployを新runで取消さない。

plan-onlyはbackendのlockfileとplan lockを両方無効にし、AWSへlockオブジェクトも書かない。
GitHub外からの同時変更までは排除できない。plan結果を後日そのままapplyせず、deploy時には
lock付きで新規planを取り、再度guardを通して、その保存planだけをapplyする。

Terraform wrapper出力を無効にし、plan本体/diagnostics/JSONはログへ出さない。JSONはguardへ
pipeし、GitHub step summaryへresource address/actionだけを表示する。生plan/ログをartifactへ
uploadせず、終了時（失敗時を含む）に削除する。plan失敗は値を含まない固定メッセージで通知する。
このsummaryは値の完全diffではない。必要な詳細レビューは秘密値を表示しない保護されたローカル
plan環境で行う。今回workflow自体は実行しておらず、本番入力のplanとAWS E2Eは次工程に残る。

初回merge前に運用担当が3変数を全て`false`で準備する。未準備ならCDは停止し、AWSは更新されない。
実際のONはSecret実値/allowlist/実AWS試験の準備後に別途判断する。この修正は実traffic切替の承認ではない。
