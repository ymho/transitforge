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
] as const;
