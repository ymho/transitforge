import {
  type JsonObject,
  validatedMessages,
  validatedModelCallId,
  validatedModelClass,
  validatedToolDefinitions,
} from "../contracts/agent-request.js";
import type {
  AgentOperation,
  AgentOperationResult,
} from "../ports/agent-operation.js";

export type {
  AgentOperation,
  AgentOperationContext,
  AgentOperationResult,
} from "../ports/agent-operation.js";

export interface AgentApplicationDependencies {
  defaultOperation: AgentOperation;
  operations?: ReadonlyMap<string, AgentOperation>;
  now?: () => number;
  log?: (event: string, fields: Record<string, unknown>) => void;
}

export class AgentApplication {
  private readonly now: () => number;
  private readonly log: (event: string, fields: Record<string, unknown>) => void;

  constructor(private readonly dependencies: AgentApplicationDependencies) {
    this.now = dependencies.now ?? (() => performance.now());
    this.log = dependencies.log ?? (() => undefined);
  }

  async execute(request: JsonObject, requestId: string): Promise<AgentOperationResult> {
    const startedAt = this.now();
    const operationName = typeof request.operation === "string"
      ? request.operation
      : "bedrock_converse";
    this.log("agent_request_started", { requestId, operation: operationName });
    const registeredOperation = this.dependencies.operations?.get(operationName);
    const operation = registeredOperation ?? this.dependencies.defaultOperation;
    const operationRequest = registeredOperation ? request : {
      ...request,
      messages: validatedMessages(request),
      ...(request.toolDefinitions === undefined
        ? {}
        : { toolDefinitions: validatedToolDefinitions(request) }),
      ...(request.modelClass === undefined
        ? {}
        : { modelClass: validatedModelClass(request) }),
      ...(request.modelCallId === undefined
        ? {}
        : { modelCallId: validatedModelCallId(request) }),
    };
    const result = await operation(operationRequest, { requestId });
    this.log("agent_request_completed", {
      requestId,
      operation: operationName,
      statusCode: result.statusCode ?? 200,
      durationMs: Math.round(this.now() - startedAt),
    });
    return result;
  }
}
