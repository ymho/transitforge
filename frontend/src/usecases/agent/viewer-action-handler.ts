import type { ViewerAgentAction } from "../viewer/viewer-action";
import { ViewerActionExecutor } from "../viewer/viewer-action-executor";
import { ViewerActionTaskScope } from "../viewer/viewer-action-policy";
import type { AgentTraceRecorder } from "./agent-trace";
import type { Evidence } from "./evidence-model";
import type { AgentRuntimeRequest, AgentViewerActionOutcome } from "./runtime-contract";

export interface AgentViewerActionHandler {
  apply(
    actions: ViewerAgentAction[],
    evidence: Evidence[],
    request: AgentRuntimeRequest,
    trace: AgentTraceRecorder,
  ): AgentViewerActionOutcome[];
}

export class EvidenceScopedViewerActionHandler implements AgentViewerActionHandler {
  constructor(private readonly executor: ViewerActionExecutor) {}

  apply(
    actions: ViewerAgentAction[],
    evidence: Evidence[],
    request: AgentRuntimeRequest,
    trace: AgentTraceRecorder,
  ): AgentViewerActionOutcome[] {
    const scope = scopeFromEvidence(request.executionId, evidence);
    return actions.map((action) => {
      const execution = this.executor.execute(action, scope, trace);
      return execution.ok
        ? { actionType: action.type, status: "applied" }
        : {
            actionType: action.type,
            status: "rejected",
            code: execution.code,
            reason: execution.reason,
          };
    });
  }
}

export function scopeFromEvidence(
  executionId: string,
  evidence: Evidence[],
): ViewerActionTaskScope {
  const scope = new ViewerActionTaskScope(executionId);
  for (const item of evidence) {
    scope.registerEvidence(item.id);
    if (item.category === "train" && typeof item.facts.serviceUid === "string") {
      scope.registerTrain(item.facts.serviceUid);
    }
    if (item.category !== "journey") continue;
    const serviceUids = item.facts.serviceUids;
    scope.registerJourney(
      item.id,
      Array.isArray(serviceUids)
        ? serviceUids.filter((value): value is string => typeof value === "string")
        : [],
    );
  }
  return scope;
}
