# Regional REST Streaming

`infra/terraform/environments/dev/agent-stream.tf`がRegional REST、専用Agent stream / personal-state / Trip API Lambda、
CloudFront behavior、Cognito authorizer、限定IAMを管理する。resource keyは`"stream"`で固定。
短命なstream / Browser切替gateは撤去済み。experiment rootは再現用で、Currentの構成正本ではない。

相談はPOST `/api/agent-stream`の`AWS_PROXY` / `STREAM`へ接続する。CloudFrontはcache無効でAuthorizationを転送し、
GatewayとBackendがAccess Token / scopeを検証する。新しいstream Function URLは作らない。
Conversation / Profile / Tripは同じREST APIへ専用Lambdaで接続し、writerの権限を分離する。

Strands v2専用Server AgentがServer stateを復元し、完了保存後のpublic finalをSSEで返す。
Browserは連番 / final / done / EOFを検証し、不完全なstreamを成功として公開しない。
現在のTool・保存・モデル設定は[Server Agent](agent-runtime.md)、認証は[共通境界](authentication.md)を参照する。

一次根拠: `agent-stream-lambda.ts` / `agent-stream-composition.ts`と隣接test、
`infra/terraform/environments/dev/tests/agent-stream.tftest.hcl`、`tools/agent-transport/production-cutover.test.ts`。
mock plan / 合成HTTP・ブラウザ試験はAWS / CDN / 実モデル品質の代替ではない。
復旧手順は[Agent v2運用](../operations/agent-deployment.md)。

経路検索と採用用の時刻表検証は、Node worker Adapterで純粋なDomain計算を実行する。
ワーカーのコードはビルド時に同じ単一CJS bundleへ埋め込み、追加ファイルや実行時のTypeScriptローダーを要求しない。
検索中も通信のイベントループは10秒heartbeatを維持する。`search_journeys`は90秒のTool上限、
ワーカーは85秒で停止する。全体のServer業務期限とBrowserの45秒idle / 270秒deadlineは維持する。
S3のgzip展開は非同期に行う。駅カタログを検索入力に含め、同名駅の異なる位置を接続しない。
250m以内の同名座標は同一駅の乗換範囲とし、通常の乗換時間を適用する。
曖昧な駅は前後の停車駅で位置を一意に確認した場合だけ路線名付きで表示・接続する。
同名駅の位置を確認できない場合や無修飾の出発地が曖昧な場合は、安全な経路を捏造しない。

final/done/EOFを失ったBrowserは、同じConversation ID / turn IDの保存結果だけを
POST `/api/conversations/v1`の`turn`操作で読んで復旧する。Agentを再実行しない。
未完了結果は2秒間隔で全体期限まで待ち、認証・旅程・会話・要求の世代変更で停止する。
保存済みpublic artifactをlive SSEと同じparserで検証し、別旅程へ遅延回答を表示しない。

Node 22 streamingのLambdaは、保存と送信をawaitした後にSDKのkeepalive接続だけで実行枠を保持しないよう
`callbackWaitsForEmptyEventLoop=false`をAdapterで設定する。予約同時実行数は2に制限し、
旅程切替時に1件の旧streamが残っても次の独立した相談を受けられる最小限の重なりを許す。
Gatewayの1 request/sec・burst 2、Serverの150秒業務期限、Lambda240秒の期限は維持する。
同じConversationの更新競合はApplicationの既存lease/CASで防ぎ、Lambdaの全体直列化に依存しない。
3件以上の重なりを無制限に受けられるという保証ではなく、並行実行の課金上限は2件になる。
診断WorkflowはGateway 5xxのstatus / integration status / response typeとLambda REPORTの最大実行時間も集計する。
生の例外、本文、ヘッダー、利用者識別子は公開しない。実際の終了時間と500の原因は本番ログで検証する。
LambdaのINIT_REPORT、許可したRuntimeエラー分類、60秒単位のInvocations / Errors / Throttles / ConcurrentExecutionsを
同じ2時間窓で照合する。2026-10-11の19:12 JSTの500に対し、直前のLambdaは19:09:55にREPORTを出していたため、
前の実行が240秒まで残ったという仮説は根因として確定していない。過去のGatewayログにintegration statusがなければ
推定で補完せず、Lambda初期化・呼び出し制限と、新しいログの実測を分けて扱う。
追加診断では同じ19:12の60秒窓にThrottles=3を確認し、Runtime初期化エラーは0だった。
入口のLambda呼び出し制限を直接原因として扱う。REPORT後の実行枠解放が遅れた理由は未確定であり、
予約同時実行数2の対策と混同しない。CDはデプロイ先の予約同時実行数を読み、2であることも検証する。

Browser consumerは検証済みfinalとdoneのフレームを受け取った時点で送信中を解除する。socketのEOFやcancel Promiseの完了を待たない。done前の切断・未完了frame・順序違反は成功と扱わない。相談履歴の末尾が利用者発言だけの場合は回答未取得を表示し、自動で再送しない。
