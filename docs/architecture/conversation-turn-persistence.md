# Conversation turn保存 — #479 Phase C

## 条件仮置き案への拡張（#455 / #456）

[条件仮置き案](agent-request-proposals.md)で、以下の本文のみ契約にoptional `tripUpdateProposal`、旅程作成前には`consultationRequestProposal`を追加した（相互排他）。
request patchだけの検証済み公開projectionをassistant messageとreceiptへ同一transactionで保存し、
初回・再送・履歴読取で保持する。本文だけの既存データは引き続き互換。Tool JSONやTraceは保存しない。

[AI費用概算](trip-cost-estimates.md)の`tripCostProposal`も同じ公開保存境界で扱う。
条件案との同時生成は保持するが、Trip作成前の相談条件案とは同時に生成しない。

## 入口と保存契約

`createConversationServerAgent(options).runConversationTurn({ principal, conversationId, turnId,
userRequest, tripId?, uiContext? })`はServer内部だけの入口である。
#489のstateful compositionと同じContext Loader / Server Runtimeを再利用し、
既存`runAgentTurn`の読取り専用契約は維持する。production handlerへ接続しない。

呼出元は認証済み`TrustedPrincipal`を供給する。principalの構造検査は認証の代替ではなく、
request bodyをprincipalとして受け入れてはならない。ownerId等の未定義fieldは拒否する。
Applicationはawait前に入力をコピーし、Repositoryもprincipalをコピーする。

turn identityは`principal.subject + conversationId + turnId`である。両IDは小文字UUID形式、
HTTP request IDやRuntime executionIdとは独立している。callerは同一操作のretryで同じturnIdを保つ。
新規操作には新しいturnIdを使う。userRequest（空白をtrimせず原文）、explicit tripId、UI itemIdの
固定順JSON配列をSHA-256にし、同一IDの異なる入力はconflictにする。空UIと省略は同値である。
raw UI stateは保存しない。raw Profileや読み込んだState全体をfingerprintへ入れない。

保存対象はuser textと正常な`completed` / `follow_up`のassistant最終textである。
Runtimeの`failed` / `limit_reached`応答は保存しない。再生契約は
`{ status: "completed" | "follow_up", response: string }`に限定する。
初回もretryも同じ契約を返し、Evidence、claims、Trace、Tool JSON、内部推論、
turnObservation、Profile、Token、provider secretをreceiptやhistoryへ保存しない。
自由文へ利用者自身が書いた秘密を検出・除去する仕組みではない。

## Key / transaction / retention

既存server-state tableと`OWNER#<principal.subject>`のPKを利用する。追加table/GSI/Scanはない。

| SK | 内容 |
| --- | --- |
| `CONVERSATION#<conversationId>` | 既存metadata、revision、messageCount |
| `MESSAGE#<conversationId>#<12桁sequence>` | 既存user/assistant text |
| `TURN#<conversationId>#<turnId>` | storageVersion/revision/deleted envelope、requestHash、state、attemptId、leaseUntil、userSequence、completed時だけresult |

beginはmetadata CAS + turn条件付きPut + user message Putの3操作を原子的に保存する。
再開はmetadata CAS + turn CASの2操作で、user messageを追加しない。
completeはmetadata CAS + turn CAS + assistant message Putの3操作、failは2操作である。
全遷移でmetadata revisionが1進み、messageCountは新しいmessage保存時だけ1進む。
競合transactionは全体を取り消すためsequenceの予約や欠番は発生しない。
metadata編集や従来appendと競合してもconflictで返し、部分保存はしない。

本文は既存16 KiB UTF-8上限、userRequestはさらに8,000文字以内である。
通常transactionは最大3 itemで、JSON escapeを含めても400 KB/item、4 MB/100操作の制限内に収まる。
AWSの制約は[TransactWriteItems](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html)を参照する。
SDKの10分ClientRequestTokenに長期の冪等性を依存させない。

receiptをTTLで消すと古いretryが新規turnとして保存され得るため、自動失効させない。
新turnの受付は既存messageCountが2,000未満の会話に限定する。各新turnはuser messageを
必ず1件保存するので、receiptは1会話最大2,000件になる。上限到達はconflictで新しい会話を要求する。
既存turnの再開・完了・再生は上限到達後も許可する。これはturn入口の上限であり、従来appendの
上限変更ではない。全accountの会話数制限・公開quotaは後続とする。
receiptは会話と同じ寿命にし、retryで新receiptを増やさない。

会話deleteのtombstone CASは全turn writeをfenceする。最初にmetadataを非表示化し、
従来のmessage cleanupの後に最大50 receiptをQuery/transactionで削除する。
1呼出しは最大50 message + 50 receipt、各transactionは最大50操作である。
両prefixを削除して初めてcomplete=trueとなる。中断時は同じ削除revisionで再試行する。
削除中のcompleted再生もnot-foundとなる。背景削除のdurable継続は引き続き#480の責務である。

## 並行要求と復旧

startedはserver生成UUIDのattemptIdと5分のleaseを持つ。実行中の同一turnは待機せずconflictを返す。
leaseは更新しない。期限後は同じ入力で再開でき、新attemptのCASで古いworkerをfenceする。
期限後の旧workerは、引継ぎ前でもcompleteできない。5分を超える処理は保存できず再実行が必要になる。
transport側ではこの上限とretry/backoffを考慮する。worker間のserver clock同期を前提とする。
別turnの同時実行を会話全体で直列化する契約はない。metadata競合はconflictとして明示する。

| 停止・失敗位置 | 保存状態 | 同じIDでの復旧 |
| --- | --- | --- |
| begin transaction前／取消 | 未開始 | beginから実行 |
| begin成功、応答喪失／process停止 | started + user 1件 | lease中はconflict、期限後にAgent再実行 |
| Context読込／Agent例外・failed・limit_reached | failed + user 1件 | 即時に新attemptでAgent再実行 |
| failed保存にも失敗 | startedの可能性 | lease期限後にAgent再実行 |
| Agent成功、complete保存前に停止／transaction失敗 | started + user 1件 | lease期限後にAgent再実行 |
| complete成功、応答喪失 | completed + user/assistant各1件 | 保存済みresultを返しAgentを再実行しない |
| lease引継ぎ後に旧workerが完了 | 新attemptが所有 | 古いattemptのcomplete/failをconflictで拒否 |
| deleteとbegin/completeが競合 | CASの勝者だけ反映 | tombstoneならnot-found |

complete呼出しの曖昧な失敗をfailedへ書き換えない。既に成功したtransactionを壊さず、
次のbeginでcompletedを再生する。Repositoryへの同一attempt/resultのcomplete retryも再生可能である。
異なるfinalを同じattemptでcompleteし直すとconflictとなる。

exactly-onceの保証は**受理済みturnのuser保存と、成功してcommitしたassistant final保存**に限る。
Agent/Bedrock実行や外部Toolの副作用にexactly-onceを保証しない。lease引継ぎ時には実行が重なる
可能性もある。書込みToolを追加する際は別途idempotencyが必要である。

## Contextと後続

user messageをbegin時に保存するので、Repositoryが返すuserSequenceを信頼済みの組成optionとして
Context Loaderへ渡す。履歴はそのsequenceの直前まで最大12件で復元し、現在のuserRequestと
二重に渡さない。retry時に追加された後続messageも含めない。
metadata/Profile/Tripは再実行時の最新の認可済み状態を読む。失敗した初回と同じモデル回答や
全resourceのsnapshot再現は保証しない。summary/resolvedTopics/pendingTopicsは既存の更新境界を維持する。
自動summary LLM callは追加しない。State/Trip参照が無効でContext読込に失敗した場合もuser保存は残り、
failedとなる。Conversationは自動createしない。

#480へ残すのはproduction Streaming handler/Browser consumerへの接続、API route、
認証からprincipalを渡す組成、HTTP上のconflict/retry表現、LocalStorage正本の切替、
legacy救済判断、account切替と遅着応答、削除継続である。AWS deploy/applyを行わない。

## 検証

SDK command fakeで原子的commit、競合、応答喪失、lease回復、owner分離、会話分離、
上限、削除とpurgeの中断を検証する。Applicationのfailure injectionと、署名JWT verifierから
stateful Server Runtimeを通るoffline統合testを含む。live DynamoDBの代替とはしない。

```bash
npm run test --workspace @raiquora/agent-api -- --maxWorkers=2
npm run build --workspace @raiquora/agent-api
npm run architecture:check
```

backend workspaceがshared Agent core testも実行する。Agent decision logicは変更せず
Smoke/Full/Live Eval、Browser recheck、root全量は省略する。root全量はGitHub CIへ委ねる。
Terraform変更はないためfmt/validateは不要。format/lint専用コマンドは定義されていない。

## #480 production経路への接続

[cutover統合](server-agent-cutover.md)が既存ApplicationをStreaming入口から利用する。
新規会話の空初期化後にbegin→load→run→complete→finalの順序を維持する。
AWS未切替であり、Browser本文からStateを復元しない。
