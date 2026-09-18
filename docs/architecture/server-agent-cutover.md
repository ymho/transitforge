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
