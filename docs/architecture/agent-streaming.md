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
