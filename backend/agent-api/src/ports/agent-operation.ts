import type { JsonObject } from "../contracts/agent-request.js";

export interface AgentOperationContext {
  requestId: string;
}

export interface AgentOperationResult {
  statusCode?: number;
  body: JsonObject;
}

/**
 * Agent APIから外部能力を呼び出す境界
 *
 * BedrockやS3などのSDK型はこのPortへ持ち込まず Adapter側で吸収する
 */
export type AgentOperation = (
  request: JsonObject,
  context: AgentOperationContext,
) => Promise<AgentOperationResult>;
