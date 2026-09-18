/** Public Application observations only: never Trace, reasoning, Tool input/output or provider text. */
export type AgentTurnEvent =
  | { type: "progress"; phase: "running" }
  | { type: "final"; status: "completed" | "follow_up"; response: string }
  | { type: "error"; code: "agent_failed" | "limit_reached" };
export type AgentTurnEventSink = (event: AgentTurnEvent) => Promise<void>;
