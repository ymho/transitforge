import type { AgentTraceRecorder } from "../agent/agent-trace";
import {
  parseViewerAgentActions,
  type ViewerAgentLayer,
  type ViewerAgentAction,
} from "./viewer-action";
import {
  validateViewerAction,
  viewerActionTarget,
  type ViewerActionEffect,
  type ViewerActionTaskScope,
} from "./viewer-action-policy";

export interface ViewerActionPorts {
  setDisplayTime: (routeTimeMinutes: number) => void;
  focusTrain: (serviceUid: string) => boolean;
  highlightRoute: (journeyId: string) => boolean;
  compareJourneys: (journeyIds: string[]) => boolean;
  showEvidence: (evidenceIds: string[]) => boolean;
  setLayerVisibility?: (layer: ViewerAgentLayer, visible: boolean) => void;
}

export type ViewerActionExecutionResult =
  | { ok: true; action: ViewerAgentAction; effect: ViewerActionEffect }
  | {
      ok: false;
      code: "invalid_action" | "invalid_time" | "entity_out_of_scope" | "execution_failed";
      reason: string;
    };

export class ViewerActionExecutor {
  constructor(
    private readonly ports: ViewerActionPorts,
    private readonly maximumRouteTime: number,
  ) {}

  execute(
    value: unknown,
    scope: ViewerActionTaskScope,
    trace: AgentTraceRecorder,
  ): ViewerActionExecutionResult {
    const actionType = rawActionType(value);
    if (scope.executionId !== trace.executionId) {
      return this.reject(
        trace,
        actionType,
        "entity_out_of_scope",
        "別のAgent実行で検証されたViewer Action scopeです",
      );
    }
    trace.viewerAction(actionType, "proposed", { targetEntityId: rawTarget(value) });
    let action: ViewerAgentAction;
    try {
      const parsed = parseViewerAgentActions([value]);
      if (!parsed[0]) throw new Error("empty action");
      action = parsed[0];
    } catch {
      return this.reject(trace, actionType, "invalid_action", "Viewer Actionの形式が不正です");
    }

    const policy = validateViewerAction(action, scope, this.maximumRouteTime);
    if (!policy.ok) {
      return this.reject(
        trace,
        action.type,
        policy.code,
        policy.reason,
        viewerActionTarget(action),
      );
    }
    try {
      if (!this.apply(action)) {
        return this.reject(
          trace,
          action.type,
          "execution_failed",
          "Viewerへ操作を反映できませんでした",
          viewerActionTarget(action),
        );
      }
    } catch {
      return this.reject(
        trace,
        action.type,
        "execution_failed",
        "Viewerへ操作を反映できませんでした",
        viewerActionTarget(action),
      );
    }
    trace.viewerAction(action.type, "applied", {
      targetEntityId: viewerActionTarget(action),
    });
    return { ok: true, action, effect: policy.effect };
  }

  private apply(action: ViewerAgentAction): boolean {
    switch (action.type) {
      case "set_display_time":
        this.ports.setDisplayTime(action.routeTimeMinutes);
        return true;
      case "focus_train":
        return this.ports.focusTrain(action.serviceUid);
      case "highlight_route":
        return this.ports.highlightRoute(action.journeyId);
      case "compare_journeys":
        return this.ports.compareJourneys(action.journeyIds);
      case "show_evidence":
        return this.ports.showEvidence(action.evidenceIds);
      case "set_layer_visibility":
        if (!this.ports.setLayerVisibility) return false;
        this.ports.setLayerVisibility(action.layer, action.visible);
        return true;
    }
  }

  private reject(
    trace: AgentTraceRecorder,
    actionType: string,
    code: Extract<ViewerActionExecutionResult, { ok: false }>["code"],
    reason: string,
    targetEntityId?: string,
  ): ViewerActionExecutionResult {
    trace.viewerAction(actionType, "rejected", { targetEntityId, reason });
    return { ok: false, code, reason };
  }
}

function rawActionType(value: unknown): string {
  return isRecord(value) && typeof value.type === "string" ? value.type : "unknown";
}

function rawTarget(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  for (const key of ["serviceUid", "journeyId"] as const) {
    if (typeof value[key] === "string") return value[key].slice(0, 160);
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
