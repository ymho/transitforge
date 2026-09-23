export type AgentToolErrorCode =
  | "invalid_input"
  | "precondition_failed"
  | "unknown_tool"
  | "not_found"
  | "outside_coverage"
  | "precondition_missing"
  | "stale_revision"
  | "permission_denied"
  | "rate_limited"
  | "unavailable"
  | "ambiguous_entity"
  | "execution_failed";

export interface AgentToolError {
  code: AgentToolErrorCode;
  message: string;
  retryable: boolean;
}

/** The same input may become valid after another Tool changes task context. */
export class AgentToolPreconditionError extends Error {
  override name = "AgentToolPreconditionError";
}

export type AgentToolResult<TOutput> =
  | { ok: true; output: TOutput }
  | { ok: false; error: AgentToolError };

export type AgentToolInputResult<TInput> =
  | { ok: true; input: TInput }
  | { ok: false; error: AgentToolError };

export interface AgentExecutionContext {
  executionId: string;
  signal?: AbortSignal;
  deadlineAt?: number;
}

export interface AgentToolInputSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface AgentToolDecisionSupport {
  capability: string;
  suitableCases?: string[];
  unsuitableCases?: string[];
  returnedEvidence?: string;
  freshness?: string;
  limitations?: string[];
  responsibilityBoundary: string;
}

export interface AgentToolDescriptor {
  name: string;
  description: string;
  inputSchema: AgentToolInputSchema;
  decisionSupport?: AgentToolDecisionSupport;
  effect?: "read" | "proposal";
  prerequisite?: string[];
  requiredCapabilities?: string[];
  outputSchema?: AgentToolInputSchema;
  errorRecovery?: Partial<Record<AgentToolErrorCode, "retry" | "resolve_precondition" | "ask_user" | "stop">>;
}

export interface AgentTool<TInput, TOutput> extends AgentToolDescriptor {
  parseInput(value: unknown): AgentToolInputResult<TInput>;
  execute(
    input: TInput,
    context: AgentExecutionContext,
  ): Promise<AgentToolResult<TOutput>>;
}

export function modelToolDescription(tool: AgentToolDescriptor): string {
  const support = tool.decisionSupport;
  const sections = [
    ...(!support ? [tool.description] : []),
    tool.effect ? `effect: ${tool.effect}` : "",
    tool.requiredCapabilities?.length ? `必要能力: ${tool.requiredCapabilities.join(" / ")}` : "",
    tool.prerequisite?.length ? `前提: ${tool.prerequisite.join(" / ")}` : "",
    tool.errorRecovery ? `回復: ${Object.entries(tool.errorRecovery).map(([code, recovery]) => `${code}=${recovery}`).join(" / ")}` : "",
    ...(!support ? [] : [
    `能力: ${support.capability}`,
    support.suitableCases?.length ? `適する: ${support.suitableCases.join(" / ")}` : "",
    support.unsuitableCases?.length ? `適さない: ${support.unsuitableCases.join(" / ")}` : "",
    support.returnedEvidence ? `Evidence: ${support.returnedEvidence}` : "",
    support.freshness ? `鮮度: ${support.freshness}` : "",
    support.limitations?.length ? `制約: ${support.limitations.join(" / ")}` : "",
    `境界: ${support.responsibilityBoundary}`,
    ]),
  ].filter(Boolean);
  // These are authored capability contracts, not untrusted Tool observations.
  // Preserve the responsibility boundary at the end; transport validates size.
  return sections.join("。");
}

export function validAgentToolInput<TInput>(
  input: TInput,
): AgentToolInputResult<TInput> {
  return { ok: true, input };
}

export function invalidAgentToolInput(
  message: string,
): AgentToolInputResult<never> {
  return {
    ok: false,
    error: { code: "invalid_input", message, retryable: false },
  };
}

export function successfulAgentToolResult<TOutput>(
  output: TOutput,
): AgentToolResult<TOutput> {
  return { ok: true, output };
}

export function failedAgentToolResult(
  error: AgentToolError,
): AgentToolResult<never> {
  return { ok: false, error };
}
