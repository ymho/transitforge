# ADR 0080: 詳細調査をboundedな同期turnとimmutable receiptで継続する

- ステータス: Accepted
- 日付: 2026-09-23
- 対象: #560（A03/A04、親 #537）

## Context

通常相談と詳細調査では必要なmodel/Tool/Provider呼出数、wall-clock、token、費用が異なる。一方、既存のConversation turnはowner・conversation・turn ID、request fingerprint、calendar date、Trip参照を5分leaseへ束縛し、完了後は同じturnの再送へimmutable resultを返す。画面切断、Server処理停止、Provider停止は別の事象であり、長時間実行hostを導入してもcheckpoint再開、exactly-once課金、根拠の鮮度は自動的には保証されない。

AWS AgentCore Runtimeのlong-running executionは長時間hostとして利用できるが、今回の詳細調査上限はServer turnのlease内に収められる。現時点で私的推論を永続checkpointにする要件はなく、別worker・別dialogue leaseを追加するとowner/revision fencingと重複課金の面が増える。

## Decision

現行Server Agentを実行hostとして維持する。通常／詳細modeは利用者のrequestとServer policyの両方で選び、standard要求をdetailedへ昇格しない。`ResearchExecutionLedger`は次の境界で外部呼出前に同期reserveする。

- `MultiStepAgentRuntime`: model call、Tool call
- Travel Discovery: Provider read call、Knowledge Base call、Rerank call
- Tool内の独立readだけを最大8、既定3で並列化する

上限を予約できないcallは開始しない。Discoveryは完了scopeと未実行scopeをtyped partialとして返し、成功済み結果を捨てない。model usage、cache read/write/miss、latencyはProvider response metadataだけから記録し、model本文の自己申告値を採用しない。料金は完全一致するmodel IDのversioned rateがある場合だけ見積もる。Provider内訳、save、retry等が観測境界へ接続されていない場合、0件と断定せず`measurementCoverage=false`とする。

成功turnの`ResearchExecutionOutcome`はConversation turn resultへ保存し、SSEと同じturn IDの再送で再取得する。再読込は新しい有料runを開始しない。Browser切断はServer停止要求ではなく、現状は処理が完了すればreceiptへ確定できる。

継続参照は2種類に分ける。

- `receipt-result`: 完了済み／部分結果の同一turn再取得
- `new-turn-request`: 未調査scopeを新しい明示turnで調べるためのrequest locator

public refはserver発行のopaque locatorにすぎず権限ではない。private receiptをowner、conversation、source turn、Trip ID/revision、presentation/candidate target、期限へdigest束縛し、owner-scoped read後に再検証する。Browser入力だけからcontinuationを実行しない。今回、durable checkpoint/resume repositoryやbackground workerは実装しないため、continuationを障害途中からのexact resumeとは表示しない。停止UIと実行中Providerの強制停止保証も未提供である。

## AgentCore比較

| 判定軸 | 現行turn + receipt | checkpoint worker / AgentCore Runtime |
|---|---|---|
| 画面離脱後の結果取得 | 同一turn receiptで対応 | 対応可能だが追加保存が必要 |
| 代表上限 | 5分lease、transportは270秒以下 | 長時間hostを構成可能 |
| checkpoint再開 | 未提供。失敗turnは再実行 | typed checkpoint repositoryを別途設計必要 |
| 重複課金 | lease takeover境界では可能性あり | exactly-onceには別idempotencyが必要 |
| owner/Trip fencing | 現行CASを再利用 | host外の同じ検証が必要 |
| 保持・削除 | Conversation寿命 | checkpointの保持・削除設計が追加 |
| 変更量・運用費 | 小さい | worker/IaC/監視/障害運用が追加 |

現行上限で代表fixtureを安全に完了／partial化できるため、AgentCore全面移行を採用しない。5分を超える実利用要求、切断後も継続必須の長時間Provider処理、再実行費が許容できないことが実測された場合、同じusecaseを包む限定adapterとowner-scoped typed checkpointを別ADRで検討する。

## Consequences

- 予算到達前に新しい外部callを止められる。開始済みで冪等性のないProvider callのexactly-onceは保証しない。
- cache節約を理由に費用上限を自動拡大しない。
- 同一turnの保存成功後応答消失／再送は既存receiptでmodel/Tool/saveを重複しない。
- cold/warm/TTL失効/低頻度のLive cost・latencyはProvider環境で別測定が必要。fixture値をLive値と呼ばない。
- durable resume未実装をUIで利用可能と表示しない。
