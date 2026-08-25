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

export interface AgentToolDescriptor {
  name: string;
  description: string;
  inputSchema: AgentToolInputSchema;
}

export interface AgentTool<TInput, TOutput> extends AgentToolDescriptor {
  parseInput(value: unknown): AgentToolInputResult<TInput>;
  execute(
    input: TInput,
    context: AgentExecutionContext,
  ): Promise<AgentToolResult<TOutput>>;
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
