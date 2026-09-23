import type { AgentTurnEventSink } from "@raiquora/agent/agent-progress";
import type { AgentRuntimeResult } from "@raiquora/agent/runtime-contract";
import type { ServerAgentTurn } from "./server-agent.js";

/** No changes to the model/tool loop. Only its verified final projection crosses this boundary. */
export async function observeAgentTurn(
  run: (input: ServerAgentTurn) => Promise<AgentRuntimeResult>, input: ServerAgentTurn, emit: AgentTurnEventSink,
): Promise<void> {
  await emit({ type: "progress", phase: "running" });
  let result: AgentRuntimeResult;
  try { result = await run(input); }
  catch { await emit({ type: "error", code: "agent_failed" }); return; }
  if (result.status === "failed" || result.status === "limit_reached") {
    await emit({ type: "error", code: result.status === "failed" ? "agent_failed" : "limit_reached" });
  } else {
    await emit({ type: "final", status: result.status, response: result.response,
      ...(result.publicPlanPresentation ? { publicPlanPresentation: result.publicPlanPresentation } : {}) });
  }
}
