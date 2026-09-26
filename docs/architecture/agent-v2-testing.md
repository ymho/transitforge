# Agent v2 テスト戦略 — greenfield acceptance

Agent v2はStrandsを使うgreenfield実装であり、V1 `MultiStepAgentRuntime` の内部挙動を再現することを目的にしない。

## Cutover gateの優先順位

1. **Domain / Repository invariant**
   - owner、CAS、Trip/Profile/Reservationの正本
   - turn idempotency / replay
   - accepted semantic state
2. **Application boundary**
   - Effective Intent
   - Tool input / intent dependency
   - Evidence admission / claim validation
   - A/B commit
3. **Agent v2 execution boundary**
   - Strands model→Tool→model loop
   - read-only Tool exposure during the current migration phase
   - model/tool/deadline budget
   - no Strands Session/Memory source of truth
4. **Live quality**
   - bounded real-model evaluation
   - useful answer、不要質問、latency、Tool/model call、token/cost

## V1 regressionとして残すもの

`modules/agent/runtime/agent-runtime.test.ts` とその周辺には、V1固有の次の確認がある。

- repair prompt本文と回数
- finalization phaseの順序
- `finalization_tool_calls` 等のV1 reason名
- planning/photo/progress guardの発火順序
- V1 response wrapper / model class routing
- V1 duplicate suppression方式

V1がproduction defaultである間はこれらを維持する。ただし**Agent v2 cutoverの合否には使わない**。

## V2で再表現する原則

V1 testが守っていたものにユーザー可視の意味がある場合、内部挙動ではなく結果のInvariantとして書き直す。

例:

- 「repairが2回走る」ではなく「未検証Claimを公開しない」
- 「finalization Toolを拒否する」ではなく「budget後に新しいProvider副作用を実行しない」
- 「planning guardが発火する」ではなく「事実を伴う旅行提案にはadmitted Evidenceがある」
- 「既知条件を聞くrepair promptを拒否する」ではなく「accepted Effective Intentを再質問しない」

## V2 acceptance catalog

`backend/agent-api/src/composition/agent-v2-acceptance-catalog.ts` をcutover gateの索引とする。

分類:

- `shared_invariant`: Agent実装によらず必要。既存Application/Repository testを再利用する。
- `v2_specific`: Strands/Application boundaryを直接検証する。
- `deferred`: 移行段階上まだV2に能力を公開していない。V1 testを借用せず、能力接続時にV2 testを新設する。

catalog testは、active gateがV1の `agent-runtime.test.ts` / `research-runtime-enforcement.test.ts` を参照しないことを強制する。

## 追加テストの判断

新しいV2 testは次の場合に追加する。

- 新しいauthority / persistence / Evidence / budget境界を接続した
- real-model evaluationで再現可能な**一般化された**failureを検出した
- user-visible invariantが既存shared testで確認できない

次の場合には追加しない。

- 特定modelの一時的な文言揺れ
- V1内部guard名を再現するだけ
- Prompt本文やmodel call回数の完全一致
- 旧Runtimeのprivate class/phaseを固定するためだけのassertion

関連: #631 #681 #691
