import { randomUUID } from "node:crypto";
import type { ConversationTurnResult } from "./ports/conversation-turn-repository.js";
import type { ConversationTurnInput } from "./usecases/agent/conversation-turn.js";
import { StateError } from "./contracts/server-state.js";
import type { AccessTokenVerifier } from "./ports/access-token-verifier.js";
import { createAgentStreamHandler, type StreamLog } from "./agent-stream-handler.js";

export interface StreamingAgentApplication {
  runConversationTurn(input: ConversationTurnInput): Promise<ConversationTurnResult>;
}

/** Authenticated streaming owns transport; the stateful Application owns one persisted turn. */
export function createProductionAgentStream(options: {
  enabled: boolean;
  path: string;
  verifier: AccessTokenVerifier;
  createApplication: (executionId: string) => StreamingAgentApplication;
  log: (fields: StreamLog) => void;
  newExecutionId?: () => string;
}) {
  return createAgentStreamHandler({
    conversationTurns: true, enabled: options.enabled, path: options.path, verifier: options.verifier,
    newRunId: options.newExecutionId ?? randomUUID, log: options.log, heartbeatMs: 10_000,
    run: async (input, emit, executionId) => {
      const application = options.createApplication(executionId);
      await emit({ type: "progress", phase: "running" });
      let result: ConversationTurnResult;
      try { result = await application.runConversationTurn(input as ConversationTurnInput); }
      catch (error) {
        await emit({ type: "error", code: error instanceof StateError && error.code === "conflict" ? "turn_conflict" : "agent_failed" });
        return;
      }
      // The transaction has completed before any final bytes are published (including replay).
      await emit({ type: "final", ...result });
    },
  });
}
