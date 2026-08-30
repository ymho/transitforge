export type AgentToolErrorCode =
  | "invalid_input"
  | "unknown_tool"
  | "not_found"
  | "ambiguous_entity"
  | "execution_failed";

export interface AgentToolError {
  code: AgentToolErrorCode;
  message: string;
  retryable: boolean;
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
  if (!support) return tool.description.slice(0, 500);
  const sections = [
    `能力: ${support.capability}`,
    support.suitableCases?.length ? `適する: ${support.suitableCases.join(" / ")}` : "",
    support.unsuitableCases?.length ? `適さない: ${support.unsuitableCases.join(" / ")}` : "",
    support.returnedEvidence ? `Evidence: ${support.returnedEvidence}` : "",
    support.freshness ? `鮮度: ${support.freshness}` : "",
    support.limitations?.length ? `制約: ${support.limitations.join(" / ")}` : "",
    `境界: ${support.responsibilityBoundary}`,
  ].filter(Boolean);
  return sections.join("。").slice(0, 500);
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
