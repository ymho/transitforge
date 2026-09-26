# V2標準構造化出力への置換と検証記録

日付: 2026-09-26。関連: #716、#722、ADR 0097。
比較基準: `bf291769f9f093777a9fa7679ddac1be854bb140`（#720）。
実モデル検証ソース: `bd7f76dd589adbe0f0807d178eac72c8e2b60e49`。
実行: GitHub Actions run [36256277003](https://github.com/ymho/transitforge/actions/runs/36256277003)。

## 置換した責務

- Strands SDK 1.18.0: Agent loop、structuredOutputSchema、構造化出力Tool、構文検証フィードバック、structuredOutput取得時の終了。
- Zod 4.4.3（lockfile解決版）: strict object/discriminated unionからSDKのJSON Schema、TypeScript型、Application入力parserを一元化。
- Application: Evidence/claim、参照一意性、現在性、Effective Intent、操作receipt、owner、A/B commit、CAS、履歴/replay。

独自submit_reply Tool、AgentV2ReplySubmission、Model Proxy、any/autoのToolChoice切替、手書きvariant parserは撤去した。回答後に終了だけのためのmodel callを要求しない。

SDKには標準のvalidation feedbackと、plain text終了時に出力Toolを指定する再要求がある。これを再試行なしと表現しない。同一invokeのturn/token/deadline上限を適用し、Applicationの独自repairや外側の再invokeは追加しない。

## Runtimeソースの実測差分

`git diff --numstat bf291769...`相当の比較。空行・コメントを含む物理行。テスト・文書・manifest・lockfile・検証workflowはこの削減数に含めない。

| 対象 | 追加 | 削除 | 純増減 |
|---|---:|---:|---:|
| strands-agent-engine.ts | 16 | 41 | -25 |
| strands-reply-submission.ts | 0 | 17 | -17 |
| agent-v2-reply.ts | 26 | 91 | -65 |
| agent-v2-publication.ts | 5 | 0 | +5 |
| strands-server-runtime.ts | 2 | 2 | 0 |
| agent-v2-system-prompt.ts | 1 | 1 | 0 |
| server-agent.ts | 1 | 1 | 0 |
| 合計 | 51 | 153 | **-102** |

独自提出状態のテストファイルも削除したが、上表へ加算しない。テスト・実モデル観測・設計文書は増やしており、repository全体の総行数削減を主張しない。

Strandsのversionは変更していない。既存lockfileにあったZodをmodules/agentの直接依存として宣言し、無関係な依存の更新は戻した。Agent coreからのAWS/Strands/Frontend/Backend依存は禁止のまま。Zodだけを可搬なschemaライブラリとして明示し、Strandsのimportを加えた負例がarchitecture checkで拒否されることも確認した。

## 決定論的検証

V2 Acceptanceは20ファイル155テスト成功（比較元: 19ファイル142テスト）。actual SDK + scripted modelである。

構文とparserの一致、構造化結果取得後の追加model callなし、SDK拒否/再要求の上限、free textや架空receiptをauthorityにしないこと、A commit後の失敗/retry、B commit/history/replay、ownerとEvidence拒否を確認した。

代表read→回答の正常経路はmodel call 2回で終了する。以前のscripted経路はread→独自submit→終了で3回だった。実利用全体の料金・latencyが同じ割合で減ったという測定ではない。

## 実Bedrock: 基礎の2ケース

外部Providerは固定値、production stateへのアクセスなし。両モデルで2ケース×3回を独立実行し、**12回すべて成功**。

| モデル | 根拠付き回答 | 未対応保存 | 実測model call合計 |
|---|---|---|---:|
| amazon.nova-lite-v1:0 | 3/3、各2 calls/1 read | 3/3、各1 call/0 reads | 9 |
| jp.amazon.nova-2-lite-v1:0 | 3/3、各2 calls/1 read | 3/3、各1 call/0 reads | 9 |

Job: Nova Lite `108443812848`、Nova 2 Lite `108443812824`。固定ケースでの結果であり、全発話での品質保証ではない。

## 実Bedrock: 4ターンのConversation

「おはよう」→「出雲大社にいきたい」→「やっぱり清水寺に行きたい。候補カードを見せて」→「この候補を保存して」。代表のproduction read Tool、Cognito/DynamoDBのfixture、実SDK/実モデルを通した。各turn最大6 cycles/2 reads/60秒。

両モデルとも4ターンの回答完了、B commit、同じturnのreplay、訂正後の清水寺カード、8件の履歴、未対応保存の明示は通った。一方、**両モデルとも条件受理revisionのassertionが失敗**し、Conversation lane全体はFAILである。成功した部分を理由にFAILを無視しない。

- Nova Lite: このrunではupdate_intentを呼ばず、初回と訂正後のintentRevisionが0のまま。
- Nova 2 Lite: 初回でupdate_intentを呼んだが既存decodeUtteranceInterpretationが拒否。後続試行は既存の1回制限で拒否された。readと構造化回答は完了したがintentRevisionは0。
- 標準SDKのread-only hookから、Tool名・decoder受理可否・閉じたエラーcodeだけを観測。会話内容、Tool payload、ID、reasoningは出していない。
- 先行run `36255621609`ではNova Liteが存在しないEvidence参照を返してApplicationが拒否した。今回の成功で、その不安定さがなくなったとは扱わない。

## 残課題と運用

#716はOPENのまま。次はupdate_intentのモデル向け入力契約とApplicationの受理条件を最小ケースで照合する。今回の出力修正へ、条件別の補修、別Semantic model call、V1 fallback、固定テンプレート、retry例外を追加しない。実モデルの条件受理失敗をテストから外すこともしない。

通常CIはpaid testをskipし、既存の手動workflow `Agent Eval / Strands v2 Live`の`conversation-output`で明示実行する。`all`は従来の基礎2ケースを維持する。CLIは`AGENT_V2_LIVE=true npm run test:agent:v2:conversation-live`。

作業用のbranch限定workflowと変換scriptは最終差分から削除した。残るのは既存手動laneへのケース追加であり、main pushで有料検証や自動書換えを起動しない。CD/IAM/production modelの変更は行わない。

実旅行Provider・実ブラウザの成功は未確認。#721の表示境界分離も今回の完了範囲に含めない。
