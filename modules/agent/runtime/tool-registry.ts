import type {
  AgentExecutionContext,
  AgentTool,
  AgentToolDescriptor,
  AgentToolInputResult,
  AgentToolResult,
} from "./tool-contract";
import { modelToolDescription } from "./tool-contract";

type RegisteredAgentTool = AgentTool<unknown, unknown>;

const validToolName = /^[a-z][a-z0-9_]{0,63}$/u;

export class AgentToolRegistrationError extends Error {
  constructor(
    readonly code: "duplicate_tool" | "invalid_tool_name",
    message: string,
  ) {
    super(message);
    this.name = "AgentToolRegistrationError";
  }
}

export class AgentToolRegistry {
  private readonly tools = new Map<string, RegisteredAgentTool>();

  register<TInput, TOutput>(tool: AgentTool<TInput, TOutput>): void {
    if (!validToolName.test(tool.name)) {
      throw new AgentToolRegistrationError(
        "invalid_tool_name",
        `Tool名「${tool.name}」は小文字英数字とアンダースコアで指定してください`,
      );
    }
    if (this.tools.has(tool.name)) {
      throw new AgentToolRegistrationError(
        "duplicate_tool",
        `Tool名「${tool.name}」はすでに登録されています`,
      );
    }
    this.tools.set(tool.name, tool as unknown as RegisteredAgentTool);
  }

  descriptors(): AgentToolDescriptor[] {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: modelToolDescription(tool),
      inputSchema: tool.inputSchema,
    }));
  }

  async execute(
    name: string,
    input: unknown,
    context: AgentExecutionContext,
  ): Promise<AgentToolResult<unknown>> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        ok: false,
        error: {
          code: "unknown_tool",
          message: `Tool「${name}」は登録されていません`,
          retryable: false,
        },
      };
    }

    const parsed = tool.parseInput(input) as AgentToolInputResult<unknown>;
    if (!parsed.ok) {
      return parsed;
    }
    try {
      return await tool.execute(parsed.input, context);
    } catch {
      return {
        ok: false,
        error: {
          code: "execution_failed",
          message: `Tool「${name}」を実行できませんでした`,
          retryable: false,
        },
      };
    }
  }
}
