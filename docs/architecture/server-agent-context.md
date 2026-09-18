# Server Agent Context — #479 Phase B

## 入口と責務

Server内部で次の読取り境界が成立する。production Browserの切替は#480で行う。

```text
Browser: IDs + user input + bounded UI hint（将来のtransport入力）
  ↓ 呼出元がJWT検証済みTrustedPrincipalを供給
Server: createStatefulServerAgent().runAgentTurn(既存ServerAgentTurn)
  ↓ createServerStateContextLoader: authorized state resolution
ConversationApplication / ProfileApplication / owner-scoped TripRepository
  ↓ 既存shared projectionによる構造化AgentRuntimeContextInput
Server MultiStepAgentRuntime → 同じContext Builder / Model / Tool loop
```

Loaderは`backend/agent-api/src/usecases/agent/server-state-context-loader.ts`へ置く。
`composition/stateful-server-agent.ts`が既存DynamoDB RepositoryとApplicationを組成し、
`createServerAgentApplication`の`loadContext` dependencyへ接続する。
stateTable/tripTableとModel/Weather portはserver compositionから与える。
ApplicationとLoaderへHTTP/API Gateway/Bedrock型、Browser API、DOM、LocalStorageを入れない。

`ServerAgentTurn`のprincipal/userRequest/conversationId?/tripId?/uiContext?と
`Promise<AgentRuntimeResult>`は維持する。既存入口の変更は、認証済みscopeのコピー後、
Tool/Model生成前にloadContextをawaitしてRuntimeのcontextへ渡すhookだけである。
依存を指定しない従来の内部組成も維持する。公開transportを繋ぐ際にはstateful組成を選ぶ。
本文のcontext、ownerId、userIdをloadContextやauthorityとして採用しない。
userRequestへState JSONを連結せず、既存Runtimeの構造化Context Builderを通す。

## 認可と参照解決

- principalは#484の`TrustedPrincipal`。構造検査は認証の代替ではなく、JWT/scope検証は呼出元の責務である。
- conversationId指定時はConversationApplication.getへprincipalをそのまま渡す。
  他owner/未知/削除済みは同じnot-found。省略時は会話なしで継続し、自動createしない。
- Conversation metadata.tripIdとexplicit tripIdが両方あって異なる場合は、Trip lookup前にinvalid-inputにする。
  同じ値ならそのTrip、片方だけならそのTrip、どちらもなければTripなしとする。
- Tripは既存Trip V2 Repository.getを同じ`principal.subject`のowner namespaceで読む。
  他owner/未知/archive済みはnot-found。共有grantから別ownerへ解決する機能はこのowner-only入口に追加しない。
  Profile、会話本文、UI item、requestのowner fieldによってnamespaceを変えない。
- ProfileApplication.getは現在のprincipalだけを読む。未登録は正常なProfileなしであり、
  保存障害/破損を未登録へ変換しない。Profileは権限・人数・今回の制約の根拠へ昇格しない。
- 入力のprincipal/IDsをawait前にコピーする。loaderにaccount横断cacheやturn共有のmutable stateはない。

conversationIdだけでも、そのmetadata.tripIdからTripを復元できる。
conversationIdなしのexplicit authorized Tripも許可する。

## Boundedな復元

Conversation metadataのtitle/scope/summary/resolvedTopics/pendingTopicsと最近のtext履歴を使う。
messageCountから`max(0, count - 12)`のsequence cursorを作り、末尾最大12件だけを取得する。
古い全履歴を順に読むことはない。DynamoDBのbyte page境界でも残り件数だけを取り、
最大12行/12回のhistory呼出しで終了する。欠落・順序不整合や途中のrevision変更はconflictとし、
部分的な会話をmodelへ渡さない。履歴0件でもmetadataを再読取りして確認する。
各resourceのread時点の認可を保証し、Conversation/Profile/Trip横断transactional snapshotは保証しない。

共有`boundAgentConversationContext`を再利用し、title 160文字、summary 800文字、
履歴最大12件×1,600文字、resolved/pending各12件×120文字にする。
さらに会話部分のJSONをescape込み12,000文字以内にする。
上限超過時は古いmessage、resolved topics、pending topicsの順に減らし、最後のmessageだけでも
超える場合はそのtextを短縮する。summaryを残し、高度な自動要約は実装しない。

Profile/Trip変換は共有`createAgentContextSnapshot`をそのまま使う。
Profileはhome、同行傾向、嗜好、未設定値、明示同意したnotesなどの既存bounded projectionとなる。
notesは同意fieldだけ各240文字であり、raw UserProfileはmodelへ送らない。
TripはRequest/PlanningState/LifecycleStateと採用済み旅程の最大24item/場所投影になり、
raw Trip、予約のprivate値、未採用候補の全文を渡さない。Requestの条件は既存Builderが意味を保って投影する。

最終的なmodel Context JSONは既存24,000文字budgetと段階圧縮に従う。
TripRequest等が圧縮後も収まらない場合は、条件を無言で落とさず既存エラーでmodel呼出し前に停止する。
今回、新しいPlanner、Tool選択規則、自動State更新は導入しない。
予約・Impact・In-trip Evidence等の追加resourceはこの3種Stateの復元とは別であり、
既存in-trip read Applicationへの本番統合は#480の残作業とする。

## UI hintとprivacy

UI入力は200文字以内のitemIdだけを取り出す。tab/scroll/panel/camera/local component stateは
Contextへ渡さず保存しない。itemIdはTrip取得のauthorityに使わない。
認可済みTrip.itemsに実在した場合だけ、共有`selectedTripItemSnapshot`でitemを投影し
`featureContext.uiFocus`へ渡す。未存在/Tripなしの場合はhintを無視し、planning stateを作らない。

Loaderは本文をログへ出さず、model Contextにprincipal/ownerを含めない。
Stateを読むServer入口はhost側`omitTraceContent`を有効にし、Runtime Traceの自由文を抑制する。
stateful compositionではConversationModelへraw model-call Traceの記録要求を渡さない。
既存Runtimeの呼出し回数・latency等の診断は維持する。Provider実装/公開Trace APIは変更しない。
送信同意は保存Traceへの同意ではなく、Profile-only/Trip-onlyでも同じ抑制を適用する。

## 書込み・後続

読み取り専用のLoaderであり、user/assistant messageの自動append、Profile更新、Trip mutationを行わない。
Phase Cの[Conversation turn保存](conversation-turn-persistence.md)が別のtransport非依存入口で
turn-level idempotencyとwrite-throughを提供する。既存runAgentTurn入力の再実行は保存件数を増やさない。
会話summaryの自動更新と構造化assistant応答の保存もこの段階では追加しない。

#462のHTTP/Function URL/SSE/streaming/progress event、#451 Phase 3のAPI Auth middleware、
Browser stream consumer、Cognito Terraform/Login UIを変更しない。transport方式を先取りしない。
production cutover、Browser State切替、account切替/遅着応答処理、LocalStorage正本停止、
必要なlegacy救済、削除のdurable継続は#480以降へ残し、Issue #479全体は閉じない。

## 検証

Context Loader隣接testは既存DynamoDB command fakeを使い、Conversation/Profile/Tripのowner分離、
欠落、Trip参照矛盾、UI item検証、末尾seekとbyte page、履歴budget、並行変更を確認する。
stateful composition testはローカル署名JWTを#484のverifierで検証し、各Repositoryから
Server Runtime/ConversationModel portまで通してContext・privacy・write-through不在を確認する。

```bash
npx vitest run backend/agent-api/src/usecases/agent/server-state-context-loader.test.ts backend/agent-api/src/composition/stateful-server-agent.test.ts modules/agent/runtime/agent-decision-context.test.ts --maxWorkers=2
npm run test --workspace @raiquora/agent-api -- --maxWorkers=2
npm run build --workspace @raiquora/agent-api
npm run architecture:check
```

backend workspace testは必要なshared Agent core testも実行する。
意思決定policy/loopを変更しないためAgent Smoke/Full/Live Evalは省略する。
Frontend全量/root全量/live AWS/production E2Eは今回ローカル実行せず、CIと#480/#461へ委ねる。
Terraform変更はないためfmt/validateも実行しない。

Phase Cの内部組成だけは、保存済みuserSequenceの直前を履歴の上限に指定する。
現在のuserRequestを履歴と重複させず、retry時の後続messageも含めない。既存の12件上限とrevision検証は維持する。
