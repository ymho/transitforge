# ADR 0046: 内部思考ではなくboundedなAgent Decision Summaryを記録する

- ステータス: Accepted
- 日付: 2026-08-30
- 関連: ADR 0023 0025 0026 0027 0031 0033 0038 0044 0045

## 背景

Bedrockへgoal 制約 Tool選択 再計画の判断を移すと Applicationが観測できるのはTool Useと
最終文面だけになる。これだけでは既知条件を聞き直した理由や Tool結果を受けた再計画を
Evaluationで判定しにくい。一方 Chain-of-Thoughtや自由記述の理由を保存すると 秘密情報や
不要な内部推論をTraceへ混入させ Traceの上限を圧迫する。

## 決定

モデルは通常の応答と同じmodel call内で provider非依存の`decision_summary`を返す。
保存するのは次の外部化可能な判断結果だけとする。

- interpreted goal
- hard constraintsとsoft preferences
- selected actionとselected tool
- unresolved facts
- closedなreason codeとreplan reason code

自由記述の推論 根拠の逐語列 Chain-of-Thoughtはschemaに含めない。文字数 配列長 key形式
許可fieldをAdapterで検証し markerは利用者向け本文から除去する。欠落または不正なsummaryは
Agent実行を失敗させず Runtimeが実際に観測したTool Useまたは回答から最小のDecision Traceへ
フォールバックする。summaryのための追加model callと常時Reflectionは行わない。

Decision SummaryはAgentの意思決定を監査 評価する情報であり 事実のEvidenceではない。
Evidence validation Claim validation Viewer Action policy runtime上限 timeoutは従来どおり
決定論的コードを正本とする。実際のTool Useと矛盾するselected action/toolは採用しない。

## 影響

- 既知hard constraintの保持や解消済み事項の聞き直しをEvalで判定できる
- providerの独自推論形式へApplicationが依存しない
- Traceの1MiB上限と秘密情報除去を維持できる
- summary欠落時も既存モデルと後方互換に動作する
- reason code追加時はcontract Prompt Evalを同時に更新する必要がある

## 確認

- `npm test`
- `npm run build`
- `npm run architecture:check`
- `npm run workspace:check`
- `npm run eval:agent:smoke`
- `npm run eval:agent:full`
