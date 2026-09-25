export interface FaultBoundaryCoverage {
  id: string;
  boundary: "authorization" | "interpretation" | "acceptance" | "runtime" | "persistence" | "delivery";
  invariant: string;
  appliesTo: string;
  allows: string;
  rejects: string;
  replacement: string;
  testFile: string;
  testName: string;
}

/** Executable index for the twenty fault boundaries required by #647.
 * The named tests run in normal CI; the catalog test also fails if a reference
 * becomes stale. Entries describe the new semantic contract, not historical
 * phase-only behavior. */
export const faultBoundaryCoverage: readonly FaultBoundaryCoverage[] = [
  { id: "F01", boundary: "authorization", invariant: "owner identity comes only from the verified principal", appliesTo: "conversation state and receipts",
    allows: "the owner to continue an equal turn ID in another conversation", rejects: "foreign leases and cross-owner reads", replacement: "principal-bound repository keys and conditions",
    testFile: "backend/agent-api/src/adapters/dynamodb-conversation-turn-repository.test.ts", testName: "scopes equal IDs to owner and conversation and rejects foreign leases" },
  { id: "F02", boundary: "interpretation", invariant: "only the trusted current utterance can ground a user fact", appliesTo: "model quotes, runtime repair, and guard messages",
    allows: "a quoted span found in the trusted user request", rejects: "a fabricated quote or relative date without a trusted clock", replacement: "Application quote validation and trusted calendar resolution",
    testFile: "modules/agent/runtime/semantic-interpretation.test.ts", testName: "rejects a fabricated quote and relative dates without a trusted clock" },
  { id: "F03", boundary: "interpretation", invariant: "a first turn may ask one typed missing-condition question", appliesTo: "planning clarification",
    allows: "a legitimate initial clarification", rejects: "questionnaire repetition of accepted conditions", replacement: "typed clarification policy based on missing facts, not phase alone",
    testFile: "modules/agent/runtime/agent-runtime.test.ts", testName: "allows one legitimate typed clarification on the first planning turn" },
  { id: "F04", boundary: "interpretation", invariant: "accepted facts are not requested again", appliesTo: "planning clarification after semantic acceptance",
    allows: "a question about a genuinely missing condition", rejects: "asking for an already accepted condition", replacement: "accepted-overlay-aware questionnaire validation",
    testFile: "modules/agent/runtime/agent-runtime.test.ts", testName: "rejects a first-turn clarification that asks for an already accepted condition" },
  { id: "F05", boundary: "acceptance", invariant: "proposal adoption is bound to the accepted intent revision", appliesTo: "Trip mutation proposal",
    allows: "the matching verified change exactly once", rejects: "an old binding after meaning changes", replacement: "CAS-bound verified-intent proposal",
    testFile: "backend/agent-api/src/composition/verified-intent-adoption-flow.test.ts", testName: "rejects an old intent binding before Trip mutation after meaning changes" },
  { id: "F06", boundary: "acceptance", invariant: "the model cannot self-assert user provenance", appliesTo: "Trip mutation proposal",
    allows: "a proposal derived from persisted accepted state", rejects: "a forged binding without accepted Working State", replacement: "Application-created binding and server lookup",
    testFile: "backend/agent-api/src/composition/verified-intent-adoption-flow.test.ts", testName: "rejects a forged binding when no matching accepted Working State exists" },
  { id: "F07", boundary: "acceptance", invariant: "accepted conditions survive answer-provider failure", appliesTo: "interpret/accept/respond ordering",
    allows: "answer retry from the persisted accepted revision", rejects: "reinterpreting the same user turn", replacement: "accept-before-respond receipt state machine",
    testFile: "backend/agent-api/src/usecases/agent/conversation-turn.test.ts", testName: "keeps accepted intent when answer generation fails and does not reinterpret on retry" },
  { id: "F08", boundary: "acceptance", invariant: "one verified proposal mutates Trip at most once", appliesTo: "proposal consumption",
    allows: "unrelated accepted intent to remain", rejects: "re-consuming the same bound change", replacement: "atomic proposal consumption and Trip CAS",
    testFile: "backend/agent-api/src/composition/verified-intent-adoption-flow.test.ts", testName: "adopts only bound verified changes, consumes them once, and retains unrelated intent" },
  { id: "F09", boundary: "runtime", invariant: "read caching includes dependency revision", appliesTo: "same Tool name and arguments after state changes",
    allows: "a repeated read after another read changes dependencies", rejects: "an unchanged duplicate read", replacement: "effect- and tool-state-revision-aware signature",
    testFile: "modules/agent/runtime/agent-runtime.test.ts", testName: "re-evaluates the same read and input after a different read changes its dependencies" },
  { id: "F10", boundary: "runtime", invariant: "side-effect proposals are never replayed implicitly", appliesTo: "write/proposal Tool retry",
    allows: "a distinct, newly bound proposal", rejects: "an identical proposal after an unrelated read", replacement: "effect-aware idempotency ledger",
    testFile: "modules/agent/runtime/agent-runtime.test.ts", testName: "never replays an identical proposal after an unrelated read succeeds" },
  { id: "F11", boundary: "runtime", invariant: "currentness failure stops the batch", appliesTo: "Tool execution after a CAS/precondition failure",
    allows: "a later user turn with refreshed state", rejects: "later batch Tools and silent replanning", replacement: "typed currentness failure terminal for the turn",
    testFile: "modules/agent/runtime/agent-runtime.test.ts", testName: "ends on Application currentness failure without later batch Tools or silent replan" },
  { id: "F12", boundary: "runtime", invariant: "external text cannot authorize a Tool", appliesTo: "retrieved source instructions",
    allows: "schema-valid Tool calls authorized by Application policy", rejects: "an unauthorized Tool name even when model output is schema-valid", replacement: "Application allowlist after model validation",
    testFile: "modules/agent/runtime/agent-runtime.test.ts", testName: "treats external source instructions as data and rejects a schema-valid unauthorized Tool name" },
  { id: "F13", boundary: "runtime", invariant: "factual claims use admitted Evidence only", appliesTo: "final repair context",
    allows: "references to admitted Evidence IDs", rejects: "candidate, invalid, or model-invented IDs", replacement: "Application-built Evidence projection",
    testFile: "modules/agent/runtime/agent-runtime.test.ts", testName: "gives repair only admitted Evidence IDs, not candidate IDs or invalid model IDs" },
  { id: "F14", boundary: "runtime", invariant: "condition acknowledgement does not require planning artifacts", appliesTo: "Evidence, itinerary, and photo gates",
    allows: "acknowledging an accepted correction or retraction", rejects: "an ungrounded new external recommendation", replacement: "response-intent-aware progress requirements",
    testFile: "modules/agent/runtime/agent-runtime.test.ts", testName: "accepts a condition acknowledgement without forcing external Evidence or a new itinerary" },
  { id: "F15", boundary: "persistence", invariant: "retry identity includes every trusted input", appliesTo: "turn replay hash",
    allows: "byte-equivalent replay", rejects: "changed Trip or UI references", replacement: "canonical trusted-input hash",
    testFile: "backend/agent-api/src/adapters/dynamodb-conversation-turn-repository.test.ts", testName: "rejects changed input including Trip/UI references before and after completion" },
  { id: "F16", boundary: "persistence", invariant: "lost responses do not duplicate history", appliesTo: "DynamoDB begin and complete ambiguity",
    allows: "safe replay across a fresh repository instance", rejects: "a second user or assistant message", replacement: "transactional receipt recovery",
    testFile: "backend/agent-api/src/adapters/dynamodb-conversation-turn-repository.test.ts", testName: "recovers lost begin/complete responses without duplicate messages" },
  { id: "F17", boundary: "persistence", invariant: "malformed, oversized, and private values are not stored", appliesTo: "conversation receipt persistence",
    allows: "the bounded public projection", rejects: "internal trace, raw Evidence, and oversized input", replacement: "closed persistence schema and size validation",
    testFile: "backend/agent-api/src/adapters/dynamodb-conversation-turn-repository.test.ts", testName: "rejects malformed/oversized inputs and excludes internal data from storage" },
  { id: "F18", boundary: "delivery", invariant: "SSE transport success is not answer success", appliesTo: "HTTP 200 event stream",
    allows: "one valid terminal answer after safe phases", rejects: "error followed by done", replacement: "typed terminal state machine",
    testFile: "frontend/src/adapters/http/agent-stream/consumer.test.ts", testName: "treats error+done as failure even under HTTP 200" },
  { id: "F19", boundary: "delivery", invariant: "semantic receipts expose no private meaning payload", appliesTo: "SSE and UI receipt",
    allows: "bounded version, revision, and outcome", rejects: "quote, value, Trip ID, or private fields", replacement: "closed public receipt parser",
    testFile: "frontend/src/adapters/http/agent-stream/consumer.test.ts", testName: "rejects private fields on a semantic receipt" },
  { id: "F20", boundary: "delivery", invariant: "interrupted streams are not silently retried", appliesTo: "abort, idle timeout, and malformed frames",
    allows: "the caller to submit a new explicit turn", rejects: "automatic replay after abort", replacement: "bounded frame parser and no-retry abort policy",
    testFile: "frontend/src/adapters/http/agent-stream/consumer.test.ts", testName: "handles abort before fetch and never retries an interrupted request" },
] as const;
