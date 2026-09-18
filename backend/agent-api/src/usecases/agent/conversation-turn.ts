import type { AgentRuntimeResult } from "@raiquora/agent/runtime-contract";
import { StateError, exactObject, requireStatePrincipal } from "../../contracts/server-state.js";
import type { ConversationTurnRepository, ConversationTurnResult } from "../../ports/conversation-turn-repository.js";
import type { ServerAgentTurn } from "./server-agent.js";

export interface ConversationTurnInput extends ServerAgentTurn { conversationId: string; turnId: string }
/** The sequence cutoff is trusted server state, never a client-selected history boundary. */
export function createConversationTurnApplication(dependencies: {
  turns: ConversationTurnRepository;
  runAgentTurn: (input: ServerAgentTurn, historyBeforeSequence: number) => Promise<AgentRuntimeResult>;
}) {
  return { async runConversationTurn(input: ConversationTurnInput): Promise<ConversationTurnResult> {
    exactObject(input, ["principal", "conversationId", "turnId", "userRequest", "tripId", "uiContext"]);
    requireStatePrincipal(input.principal);
    const snapshot = structuredClone(input);
    const { principal, conversationId, turnId, userRequest, tripId, uiContext } = snapshot;
    const identity = { principal, conversationId, turnId };
    const begun = await dependencies.turns.beginTurn(identity, { userRequest, tripId, uiContext });
    if (begun.state === "completed") return begun.result;
    let result: ConversationTurnResult;
    try {
      const runtime = await dependencies.runAgentTurn({ principal, conversationId, userRequest, tripId, uiContext }, begun.lease.userSequence);
      if (runtime.status !== "completed" && runtime.status !== "follow_up") throw new StateError("unavailable");
      result = { status: runtime.status, response: runtime.response };
    } catch {
      // Best effort only. If recording failure is unavailable, lease expiry enables recovery.
      try { await dependencies.turns.failTurn(identity, begun.lease); } catch { /* No raw exception/trace retention. */ }
      throw new StateError("unavailable");
    }
    // An ambiguous completion must not transition to failed: the transaction may have committed.
    return dependencies.turns.completeTurn(identity, begun.lease, result);
  } };
}
