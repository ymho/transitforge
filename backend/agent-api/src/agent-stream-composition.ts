import { randomUUID } from "node:crypto";
import type { AgentRuntimeResult } from "@raiquora/agent/runtime-contract";
import type { AccessTokenVerifier } from "./ports/access-token-verifier.js";
import type { ServerAgentTurn } from "./usecases/agent/server-agent.js";
import { observeAgentTurn } from "./usecases/agent/observe-agent-turn.js";
import { createAgentStreamHandler, type StreamLog } from "./agent-stream-handler.js";

export interface StreamingAgentApplication {
  runAgentTurn(input: ServerAgentTurn): Promise<AgentRuntimeResult>;
}

/** #479 replaces the factory with a Context Loader composition, not the HTTP/auth boundary. */
export function createProductionAgentStream(options: {
  enabled: boolean;
  path: string;
  verifier: AccessTokenVerifier;
  createApplication: (executionId: string) => StreamingAgentApplication;
  log: (fields: StreamLog) => void;
  newExecutionId?: () => string;
}) {
  return createAgentStreamHandler({
    enabled: options.enabled, path: options.path, verifier: options.verifier,
    newRunId: options.newExecutionId ?? randomUUID, log: options.log, heartbeatMs: 10_000,
    run: async (input, emit, executionId) => {
      const application = options.createApplication(executionId);
      await observeAgentTurn(turn => application.runAgentTurn(turn), input, emit);
    },
  });
}
