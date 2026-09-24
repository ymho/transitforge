export interface AgentRuntimeLimits {
  maxIterations: number;
  maxModelCalls: number;
  maxToolCalls: number;
  maxExecutionMs: number;
  maxEvidence: number;
}

export const defaultAgentRuntimeLimits: AgentRuntimeLimits = {
  // Open-ended discovery commonly needs candidate discovery, source reading and
  // several place-photo lookups before the final presentation. Keep enough
  // result-driven rounds for that path while retaining the production Tool cap.
  maxIterations: 6,
  maxModelCalls: 8,
  maxToolCalls: 8,
  maxExecutionMs: 15_000,
  maxEvidence: 20,
};

export function validateAgentRuntimeLimits(
  input: Partial<AgentRuntimeLimits> = {},
): AgentRuntimeLimits {
  const limits = { ...defaultAgentRuntimeLimits, ...input };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`${name}は1以上の整数で指定してください`);
    }
  }
  if (limits.maxModelCalls < limits.maxIterations) {
    throw new Error("maxModelCallsはmaxIterations以上にしてください");
  }
  return limits;
}
