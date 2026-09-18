import type { AgentTurnObservation, AgentTurnOutcome } from "@raiquora/agent/agent-turn-outcome";

/** Bounded tab-lifetime observation cache. Switching sessions never mixes turns; reload starts unknown. */
export function createAgentTurnObservationStore(maximumSessions = 20) {
  const values = new Map<string, AgentTurnOutcome>();
  return {
    get: (sessionId: string) => values.get(sessionId),
    record(sessionId: string, observation: AgentTurnObservation) {
      values.delete(sessionId);
      values.set(sessionId, observation.outcome);
      if (values.size > maximumSessions) values.delete(values.keys().next().value!);
    },
  };
}
