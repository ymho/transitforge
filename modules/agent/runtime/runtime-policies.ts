export interface AgentRuntimeLimits {
  maxIterations: number;
  maxModelCalls: number;
  maxToolCalls: number;
  maxExecutionMs: number;
  maxEvidence: number;
}

export const defaultAgentRuntimeLimits: AgentRuntimeLimits = {
  maxIterations: 4,
  maxModelCalls: 5,
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
