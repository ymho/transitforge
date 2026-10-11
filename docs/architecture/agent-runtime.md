# Server Agentの実行境界

Browser（入力・表示）→ Cognito Access Token → CloudFront → Regional REST `/api/agent-stream` →
JWT / scope検証 → TrustedPrincipal → Conversation turn / Server Context復元 → Strands v2 →
Server Tool / Application検証 → final保存 → SSE / Chat表示。

`createProductionServerAgent`はStrands v2 runnerを必ず組成する。旧Runtime / Prompt / Semantic pre-loopは撤去済み。
Browserにmodel / tool loop、旧経路へのfallback、起動時Trip recheckはない。
Conversation / Profile V3 / Trip V2はServer正本。通常一覧・履歴は再読込後もServerから取得する。

## 入力・保存・表示

入力はconversationId / turnId / userRequestと、許可されたtripId / bounded uiContextなどの参照。
Browserのhistory / Profile / Trip本文 / Tool定義 / principalを認可やContextの正本にしない。
認証・account・会話・Trip・requestの世代変更で古い非同期結果を破棄する。
同じ完了済みturnの再送は保存済みfinalを返し、model / Toolを再実行しない。partial streamを成功扱いしない。

public finalは本文・delivery・receipt・publicカード・採用参照を持ち、live / 履歴 / replayを
同じ`AssistantTurnView`へ投影する。内部推論・Provider raw・Traceを公開しない。
会話の条件受理と候補採用はApplicationがowner・対象・Evidence・期限・revision / CASを検証する。
検索・比較だけでは保存せず、採用成功時だけreceiptを返してTripを再取得する。
[候補選択](../specs/agent-publication.md)と[公開表示契約](../specs/agent-publication.md)を参照する。

## Tool・Infraの正本

| 境界 | 実装の正本 |
| --- | --- |
| production組成・SDK loop | `backend/agent-api/src/production-server-agent-composition.ts`、`adapters/strands-agent-engine.ts` / `strands-server-runtime.ts` |
| Tool登録 | `backend/agent-api/src/composition/production-server-tools.ts`、`usecases/agent`。条件Tool / 候補採用も既存Applicationへ接続する |
| 保存・復元 | `composition/production-conversation-agent.ts`、`usecases/agent/conversation-turn.ts` / `server-state-context-loader.ts`と各test |
| 公開route / IAM | `infra/terraform/environments/dev/agent-stream.tf` / `cognito.tf` / `fixed-egress-provider.tf`とoffline test |
| CDモデル設定 | `.github/workflows/cd.yml`は`jp.anthropic.claude-sonnet-4-6`を明示。Terraformの単体既定値と区別する |

Agent LambdaはVPC外、宿泊はIAM Invoke → 固定egress Provider Lambda → NAT / EIP。
非travel Secretと宿泊credentialsを分離する。短命Browser / stream gateは撤去済み。
`enable_fixed_egress_provider`は固定IP境界の設定として残る。
残存`/api/agent`の独立read operationとFunction URL / OACは別契約で、汎用会話・feedback・traceは410。
[旧ingress閉鎖](authentication.md)を参照する。

Server business deadlineはTerraform既定150,000ms、整数1,000〜180,000ms。Lambda等のtransport timeoutとは別。
復旧は[Agent v2実環境運用](../operations/agent-deployment.md)に従い、失効したV1フラグへ戻さない。
CI成功・固定ProviderのLive成功は実Provider / 実画面E2Eの完成証明ではない。
