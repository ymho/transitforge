import type { JsonObject } from "../contracts/agent-request.js";

export interface ModelCallFailureDiagnostic {
  name: string;
  message: string;
  statusCode?: number;
  providerRequestId?: string;
  retryable?: boolean;
}

export interface ModelCallTraceRecord {
  modelCallId: string;
  apiRequestId: string;
  startedAt: string;
  completedAt: string;
  providerRequest: JsonObject;
  outcome:
    | {
        status: "completed";
        stopReason: string;
        modelId: string;
        latencyMs: number;
        usage?: {
          inputTokens?: number;
          outputTokens?: number;
          totalTokens?: number;
        };
      }
    | {
        status: "failed";
        error: ModelCallFailureDiagnostic;
      };
}

export interface ModelCallTraceRecorder {
  record(value: ModelCallTraceRecord): Promise<void>;
}
