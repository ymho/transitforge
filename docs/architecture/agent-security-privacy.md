# Agent・旅行案のSecurity / Privacy threat model

対象は認証済みConversation、Working State、Evidence、旅行候補、採用preview、Trip保存、SSE表示である。LLM、Web本文、施設名、画像metadata、Profile note、Browser bodyは信頼しない。認証principal、owner/revision-bound Repository、既存Proposal/CAS/Reservation protectionだけをauthorityとする。

## 境界と実行負例

| 脅威 | 入口・信頼境界 | 決定論的防御 | 実行テスト | 残余リスク |
| --- | --- | --- | --- | --- |
| 他owner / 他Trip参照 | HTTP ID、model Tool input、Working State | Cognito principalをserver注入しowner partitionからのみread。Trip ID、conversation、base revisionをApplicationで再照合 | `conversation-application.test.ts`、`server-state-context-loader.test.ts`、`plan-candidate-adoption.test.ts` | ID存在の推測を避けるためnot-foundを同形に保つ |
| stale候補 / Evidence | Candidate ref、Evidence ID | Candidateの発行期限・conversation・Trip revision・request fingerprintを検証。Evidenceはsubject/scope/applicability/鮮度を検証しID存在だけで支持しない | `plan-candidate-adoption.test.ts`、`evidence-model.test.ts`、`external-travel-evidence-lineage.test.ts` | 外部source自体の誤情報はcoverage/unknownとして残る |
| 偽confirmation / mutation再利用 | confirm body、再送 | Browser bodyのconfirmationをauthorityへ直接昇格せず、server保存previewの定数時間比較、Proposal CAS、mutation receiptを通す | `trip-handler.test.ts`、`plan-candidate-adoption.test.ts` | 利用者端末の乗っ取りはCognito/session対策の範囲 |
| 外部prompt injection | Web本文、施設名、引用、Profile note | すべてdynamic JSON dataとして引用しsystem/cache prefixへ入れない。実行は登録済みnative Tool Useのみ。保存Toolはなく、Applicationがowner/CASを再検証 | `agent-runtime.test.ts`、`response-contract.test.ts`、`context-compiler.test.ts` | モデルが許可済みreadを余分に選ぶ可能性はResearch Budgetで上限化 |
| malformed/deep/duplicate input | API、Tool、Presentation、Candidate | exact keys、深さ/byte/array上限、重複ref、非有限数、prototype由来keyをschemaと意味検証で拒否 | `agent-request.test.ts`、`public-plan-presentation.test.ts`、`grounded-answer.test.ts`、`trip-handler.test.ts` | 文字の見た目が似る問題はID完全一致を維持する |
| partial / delayed stream | SSE、account/conversation/trip切替 | finalを一時保留し、valid final + done + EOFが揃うまで描画しない。generation変更、invalid Presentation、順序違反を破棄 | `consumer.test.ts`、`agent-stream-composition.test.ts` | 切断後の完了結果は同じturn IDの明示再送でreceiptを読む |
| 部分更新 / retry | state table、trip table、Provider失敗 | ConversationとturnはCAS transaction、TripはProposal/CAS/mutation receipt。候補採用previewはimmutable。同一mutationの副作用は1回 | `dynamodb-conversation-turn-repository.test.ts`、`plan-candidate-adoption.test.ts` | Conversation削除はcross-table transactionではないため下記のresumable contractを使う |
| 生会話・私的推論の診断流出 | Trace、model failure、CloudWatch | diagnosticsはID・phase・件数・latencyだけ。Trace payloadはcontent-free/redacted、Profileを含むmodel requestは本文ごと省略 | `server-agent-diagnostics.test.ts`、`agent-trace.test.ts`、`model-call-trace.test.ts` | Cloud providerの基盤ログはAWS側保持設定に従う |

## 保持・削除contract

Conversation deleteは最初にstate tableの本文を持たないtombstoneをCAS保存し、`MESSAGE#`、`TURN#`、`WORKING#`をowner + conversation prefixで50件ずつ削除する。続いてtrip tableの`CANDIDATE#<conversation>#`と`CANDIDATE_ADOPTION#<conversation>#`を同じowner partitionから50件ずつ削除する。両tableが完了した場合だけ`complete: true`を返す。片側失敗、1 MB page境界、response lossでは同じexpected revisionで再送し、tombstoneから再開する。全table Scan、他owner partition、Trip、Reservation、Profileは対象にしない。

Candidateとadoption previewの新規keyはconversation prefixを含む。旧`CANDIDATE_ADOPTION#<mutationId>`形式はconversationから逆引きできず、Scanなしには削除不能であるためdual-readしない。既存環境に旧形式が存在しないことは本PRでは実地inventoryしておらず、存在する場合はConversation削除済みとみなせない。全table Scanをproduction requestへ追加せず、環境ごとの明示的inventoryと削除手順を別migrationとして実施する。`expiresAtIso`は採用可否の期限でありDynamoDB TTLではないため、会話を残した期限切れ候補の物理evictionも引き続き別cleanup jobの課題である。

会話本文、Working State、Candidate、adoption previewは削除対象である一方、採用済みTripとReservationはConversationから独立した利用者データなので残す。Profile deleteはProfile自身のgeneration tombstoneを使い、Conversation削除からは変更しない。S3 Agent Traceは現在のproduction会話経路ではraw本文を保存せず、保存済みTraceの削除APIは未実装である。これは残余課題であり、Trace保存を会話削除済みと同一視しない。

## 検証範囲

本suiteは合成principal、合成Provider、保存済みfixtureで実行する。Live個人データを使う攻撃試験、全攻撃への安全宣言、禁止語regexだけの防御は行わない。schema validは認可・事実・confirmationの保証ではなく、各Applicationでowner、revision、scope、鮮度、参照対応を再検証する。
