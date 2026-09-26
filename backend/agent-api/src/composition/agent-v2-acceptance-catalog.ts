export type AgentV2AcceptanceKind = "shared_invariant" | "v2_specific" | "deferred";

export interface AgentV2AcceptanceEntry {
  id: string;
  kind: AgentV2AcceptanceKind;
  invariant: string;
  testFile?: string;
  testName?: string;
  reason?: string;
}

/**
 * Agent v2 cutover gate.
 *
 * This catalog intentionally references public Application/Repository boundaries
 * and the greenfield Strands adapter. V1 MultiStepAgentRuntime tests are not a
 * compatibility oracle for v2.
 */
export const agentV2AcceptanceCatalog: readonly AgentV2AcceptanceEntry[] = [
  {
    id: "V2-AUTH-01",
    kind: "shared_invariant",
    invariant: "owner identity comes only from the verified principal and foreign turn state is not visible",
    testFile: "backend/agent-api/src/adapters/dynamodb-conversation-turn-repository.test.ts",
    testName: "scopes equal IDs to owner and conversation and rejects foreign leases",
  },
  {
    id: "V2-TURN-01",
    kind: "shared_invariant",
    invariant: "lost responses and retries never duplicate user or assistant history",
    testFile: "backend/agent-api/src/adapters/dynamodb-conversation-turn-repository.test.ts",
    testName: "recovers lost begin/complete responses without duplicate messages",
  },
  {
    id: "V2-SEMANTIC-01",
    kind: "shared_invariant",
    invariant: "accepted meaning survives answer failure and retry does not reinterpret the same turn",
    testFile: "backend/agent-api/src/usecases/agent/conversation-turn.test.ts",
    testName: "keeps accepted intent when answer generation fails and does not reinterpret on retry",
  },
  {
    id: "V2-INTENT-01",
    kind: "v2_specific",
    invariant: "a semantic delta accepted by the Application is visible to later read Tool validation in the same Strands loop",
    testFile: "backend/agent-api/src/adapters/strands-agent-engine.test.ts",
    testName: "uses an Application-accepted intent update for later read Tool validation in the same Strands loop",
  },
  {
    id: "V2-SEMANTIC-03",
    kind: "v2_specific",
    invariant: "an accepted intent A-commit survives answer failure and retry does not reapply the change",
    testFile: "backend/agent-api/src/composition/strands-conversation-production-shaped.test.ts",
    testName: "persists a V2 intent A-commit across answer failure and retries without reapplying the semantic change",
  },
  {
    id: "V2-INTENT-PUBLICATION-01",
    kind: "v2_specific",
    invariant: "updated-intent Evidence reaches persisted and replayable replies without charging local operations to the Domain Tool budget",
    testFile: "backend/agent-api/src/composition/strands-intent-acceptance.test.ts",
    testName: "publishes updated-intent Evidence through A commit, a read, B commit, history and replay within one Domain Tool budget",
  },
  {
    id: "V2-INTENT-MULTITURN-01",
    kind: "v2_specific",
    invariant: "conditions corrected on a later turn govern both reads and reply publication",
    testFile: "backend/agent-api/src/composition/strands-intent-acceptance.test.ts",
    testName: "uses corrected conditions for both read validation and publication on a later turn",
  },
  {
    id: "V2-INTENT-VALIDATION-01",
    kind: "v2_specific",
    invariant: "one shared Tool syntax and source validation reject invalid condition input before acceptance",
    testFile: "backend/agent-api/src/composition/strands-intent-acceptance.test.ts",
    testName: "rejects invalid %s input without changing conditions",
  },
  {
    id: "V2-INTENT-LIFECYCLE-01",
    kind: "v2_specific",
    invariant: "reply submission closes intent mutation and unchanged conversation does not create an intent commit",
    testFile: "backend/agent-api/src/composition/strands-intent-acceptance.test.ts",
    testName: "does not mutate intent after reply submission or on an unchanged conversational turn",
  },
  {
    id: "V2-INTENT-RETRY-01",
    kind: "v2_specific",
    invariant: "the SDK can return validation feedback without an invocation-wide mutation lock",
    testFile: "backend/agent-api/src/composition/strands-intent-acceptance.test.ts",
    testName: "uses standard Tool validation feedback and accepts a valid operation after rejected input",
  },
  {
    id: "V2-INTENT-RECOVERY-01",
    kind: "v2_specific",
    invariant: "an ambiguous post-commit refresh failure cannot publish stale state and retry preserves the accepted revision",
    testFile: "backend/agent-api/src/composition/strands-intent-acceptance.test.ts",
    testName: "fails closed after post-commit context refresh failure and resumes without a second intent application",
  },
  {
    id: "V2-CONDITIONS-BATCH-01", kind: "v2_specific",
    invariant: "independent conditions in one model response are sequentially accepted before read and replay",
    testFile: "backend/agent-api/src/composition/strands-intent-acceptance.test.ts",
    testName: "executes independent conditions in one model response before reading and replaying the final reply",
  },
  {
    id: "V2-CONDITIONS-RECOVERY-01", kind: "v2_specific",
    invariant: "accepted operations survive a later operation failure and replay never rolls back the latest state",
    testFile: "backend/agent-api/src/adapters/dynamodb-condition-operations.test.ts",
    testName: "retains a committed first operation when the second fails and resumes only the missing work",
  },
  {
    id: "V2-CONDITIONS-FENCE-01", kind: "v2_specific",
    invariant: "an unfinished older turn cannot overwrite newer conditions or publish a stale reply",
    testFile: "backend/agent-api/src/adapters/dynamodb-condition-operations.test.ts",
    testName: "fences unfinished older turns before new writes, new replies or resumed work",
  },
  {
    id: "V2-CONDITIONS-PARTY-01", kind: "v2_specific",
    invariant: "one current-trip party operation preserves total-only uncertainty, explicit adult/child composition, replay and retraction without Profile inference",
    testFile: "modules/agent/runtime/conversation-condition.test.ts",
    testName: "keeps total-only party separate from an explicit adult/child composition without guessing ages",
  },
  {
    id: "V2-PROFILE-READ-01", kind: "v2_specific",
    invariant: "current conditions override profile hints without mutating the Profile or reviving a retracted default",
    testFile: "backend/agent-api/src/composition/strands-intent-acceptance.test.ts",
    testName: "overrides profile hints only in this Conversation and retracts without reviving a hidden default",
  },
  {
    id: "V2-TOOL-01",
    kind: "v2_specific",
    invariant: "stale or mismatched Effective Intent is rejected before a Domain Tool executes",
    testFile: "backend/agent-api/src/adapters/strands-agent-engine.test.ts",
    testName: "rejects stale model Tool input before the Domain Tool executes",
  },
  {
    id: "V2-TOOL-02",
    kind: "v2_specific",
    invariant: "the initial greenfield runtime exposes read Tools only",
    testFile: "backend/agent-api/src/adapters/strands-agent-engine.test.ts",
    testName: "does not expose proposal Tools in the initial Strands slice",
  },
  {
    id: "V2-EVIDENCE-01",
    kind: "v2_specific",
    invariant: "admitted Evidence is validated and projected instead of publishing unbound model prose",
    testFile: "backend/agent-api/src/adapters/strands-server-runtime.test.ts",
    testName: "publishes verified Evidence instead of unbound model prose",
  },
  {
    id: "V2-EXPLANATION-01",
    kind: "v2_specific",
    invariant: "natural explanation and comparison remain model-authored inference while factual values stay bound to selected Evidence fields",
    testFile: "modules/agent/runtime/agent-v2-publication.test.ts",
    testName: "publishes natural commentary as an inference bound to the selected Evidence instead of replacing factual values",
  },
  {
    id: "V2-PLACE-CARDS-01",
    kind: "v2_specific",
    invariant: "resolved place Evidence can become owner-scoped replayable candidate cards without a photo or Trip mutation",
    testFile: "backend/agent-api/src/composition/strands-place-cards-acceptance.test.ts",
    testName: "publishes a real travel read as cards through Strands, A/B commits, owner-scoped history and replay without photos or writes",
  },
  {
    id: "V2-PLACE-CURRENTNESS-01",
    kind: "v2_specific",
    invariant: "candidate reads made before an intent update cannot become a successful reply for the new conditions",
    testFile: "backend/agent-api/src/composition/strands-place-cards-acceptance.test.ts",
    testName: "cannot publish old candidate Evidence after an intent update and can retry against the committed conditions",
  },
  {
    id: "V2-PLACE-STREAM-01",
    kind: "v2_specific",
    invariant: "a lost final stream cannot lose or duplicate the committed candidate snapshot",
    testFile: "backend/agent-api/src/composition/strands-place-cards-acceptance.test.ts",
    testName: "commits cards before final SSE bytes and replays them after a lost response without repeating a travel read",
  },
  {
    id: "V2-PLACE-PAYLOAD-01",
    kind: "v2_specific",
    invariant: "models select references rather than supplying card facts, URLs, photos or operation results",
    testFile: "modules/agent/runtime/agent-v2-candidates.test.ts",
    testName: "does not accept model-supplied card data or mutation outcomes",
  },
  {
    id: "V2-PLACE-STORAGE-01",
    kind: "v2_specific",
    invariant: "a repeated completion cannot overwrite already committed candidate cards",
    testFile: "backend/agent-api/src/adapters/dynamodb-place-presentation.test.ts",
    testName: "persists a detached card snapshot and fences a different card body on repeated completion",
  },
  {
    id: "V2-PLACE-VIEW-01",
    kind: "v2_specific",
    invariant: "live SSE and restored history use the same validated snapshot and do not duplicate the candidate card",
    testFile: "frontend/src/presentation/concierge/public-place-presentation-view.test.ts",
    testName: "renders the same candidate snapshot from final SSE and restored history without duplicating the card",
  },
  {
    id: "V2-CONTEXT-01",
    kind: "v2_specific",
    invariant: "the model receives the existing bounded Application context rather than a second v2 state model",
    testFile: "backend/agent-api/src/adapters/strands-server-runtime.test.ts",
    testName: "passes the existing bounded Application context to Strands",
  },
  {
    id: "V2-LOOP-01",
    kind: "v2_specific",
    invariant: "the production-shaped Conversation path can execute the real Strands model→Tool→model loop without invoking V1",
    testFile: "backend/agent-api/src/composition/strands-conversation-production-shaped.test.ts",
    testName: "runs an actual Strands model-tool-model loop inside the production-shaped Conversation path",
  },
  {
    id: "V2-CONVERSATION-01",
    kind: "v2_specific",
    invariant: "a no-evidence conversational reply is Application-admitted, persisted and replayed without Domain Tool or V1 execution",
    testFile: "backend/agent-api/src/composition/strands-conversation-production-shaped.test.ts",
    testName: "publishes and replays a no-evidence greeting without calling Domain Tools or V1",
  },
  {
    id: "V2-AUTHORITY-02",
    kind: "v2_specific",
    invariant: "an unavailable save request is reported as unavailable and replayed without claiming or performing a write",
    testFile: "backend/agent-api/src/composition/strands-conversation-production-shaped.test.ts",
    testName: "reports unavailable save through the Application boundary and replays it without side effects",
  },
  {
    id: "V2-REPLAY-01",
    kind: "v2_specific",
    invariant: "Conversation completion replay, owner isolation, and published Evidence continuity hold across the v2 runtime seam",
    testFile: "backend/agent-api/src/composition/conversation-server-agent.test.ts",
    testName: "runs the production-shaped Conversation state path through the trusted Strands Runtime seam",
  },
  {
    id: "V2-BUDGET-01",
    kind: "v2_specific",
    invariant: "Tool budget is enforced before an additional Domain/Provider side effect",
    testFile: "backend/agent-api/src/adapters/strands-agent-engine.test.ts",
    testName: "stops additional Tool side effects after the per-turn Tool budget is exhausted",
  },
  {
    id: "V2-BUDGET-02",
    kind: "v2_specific",
    invariant: "the Application deadline cancels Strands execution and maps to a bounded limit result",
    testFile: "backend/agent-api/src/adapters/strands-agent-engine.test.ts",
    testName: "marks the invocation as deadline-limited when the Strands invocation is cancelled by its deadline",
  },
  {
    id: "V2-CLARIFICATION-01",
    kind: "deferred",
    invariant: "accepted conditions are not asked again while a genuinely missing user-owned condition may be clarified",
    reason: "Re-express as a v2 user-visible behavior test; do not reuse V1 repair/guard assertions.",
  },
  {
    id: "V2-CURRENTNESS-01",
    kind: "deferred",
    invariant: "a stale write/proposal cannot continue with later side effects in the same turn",
    reason: "Write/proposal Tools are intentionally not exposed to Strands yet.",
  },
  {
    id: "V2-WRITE-01",
    kind: "deferred",
    invariant: "proposal adoption remains Application-bound, CAS-protected, and exactly-once",
    reason: "Keep existing Application adoption tests; add a v2 execution-path test only when write/proposal Tools are connected.",
  },
  {
    id: "V2-OUTPUT-NATIVE-01", kind: "v2_specific",
    invariant: "a validated SDK structured result ends without an additional model request",
    testFile: "backend/agent-api/src/adapters/strands-structured-output.test.ts",
    testName: "lets the SDK end on a validated result without an Application submit Tool or trailing model call",
  },
  {
    id: "V2-OUTPUT-BOUNDED-01", kind: "v2_specific",
    invariant: "SDK validation retries share the invoke budget and never become a fabricated reply",
    testFile: "backend/agent-api/src/adapters/strands-structured-output.test.ts",
    testName: "bounds repeated invalid structured output without a custom repair loop or fake success",
  },
] as const;
