import { randomUUID } from "node:crypto";

import { RequestError, requestValue } from "./contracts/agent-request.js";
import {
  jsonResponse,
  type LambdaContext,
  type LambdaHttpEvent,
  type LambdaHttpResponse,
} from "./contracts/http.js";
import type { AgentApplication } from "./usecases/agent-application.js";

export type AgentApiLog = (
  event: string,
  fields: Record<string, unknown>,
) => void;

export function createAgentApiHandler(
  application: Pick<AgentApplication, "execute">,
  options: {
    requestId?: () => string;
    log?: AgentApiLog;
  } = {},
): (event: LambdaHttpEvent, context?: LambdaContext) => Promise<LambdaHttpResponse> {
  const createRequestId = options.requestId ?? randomUUID;
  const log = options.log ?? (() => undefined);
  return async (event, context) => {
    const requestId = context?.awsRequestId ?? context?.aws_request_id ?? createRequestId();
    try {
      const value = requestValue(event);
      const result = await application.execute(value, requestId);
      return jsonResponse(result.statusCode ?? 200, result.body, requestId);
    } catch (error) {
      if (error instanceof RequestError) {
        log("agent_request_rejected", { requestId, statusCode: error.statusCode });
        return jsonResponse(error.statusCode, { message: error.message }, requestId);
      }
      log("agent_request_failed", { requestId, statusCode: 500 });
      return jsonResponse(500, { message: "案内を開始できませんでした。" }, requestId);
    }
  };
}
