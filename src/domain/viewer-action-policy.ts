import type { ViewerAgentAction } from "./viewer-agent-action";

export type ViewerActionEffect = "reversible" | "display_only";

export type ViewerActionPolicyResult =
  | { ok: true; effect: ViewerActionEffect }
  | {
      ok: false;
      code: "invalid_time" | "entity_out_of_scope";
      reason: string;
    };

export class ViewerActionTaskScope {
  private readonly trainIds = new Set<string>();
  private readonly journeyIds = new Set<string>();
  private readonly evidenceIds = new Set<string>();

  constructor(readonly executionId: string) {
    if (!executionId) throw new Error("Viewer Action scopeにはexecutionIdが必要です");
  }

  registerTrain(serviceUid: string): void {
    this.trainIds.add(serviceUid);
  }

  registerJourney(journeyId: string, serviceUids: string[] = []): void {
    this.journeyIds.add(journeyId);
    serviceUids.forEach((serviceUid) => this.registerTrain(serviceUid));
  }

  registerEvidence(evidenceId: string): void {
    this.evidenceIds.add(evidenceId);
  }

  hasTrain(serviceUid: string): boolean {
    return this.trainIds.has(serviceUid);
  }

  hasJourney(journeyId: string): boolean {
    return this.journeyIds.has(journeyId);
  }

  hasEvidence(evidenceId: string): boolean {
    return this.evidenceIds.has(evidenceId);
  }
}

export function validateViewerAction(
  action: ViewerAgentAction,
  scope: ViewerActionTaskScope,
  maximumRouteTime: number,
): ViewerActionPolicyResult {
  if (action.type === "set_display_time") {
    if (action.routeTimeMinutes > maximumRouteTime) {
      return {
        ok: false,
        code: "invalid_time",
        reason: "表示可能な時刻の範囲を超えています",
      };
    }
    return { ok: true, effect: "reversible" };
  }
  if (action.type === "set_weather" || action.type === "set_layer_visibility") {
    return { ok: true, effect: "reversible" };
  }
  if (action.type === "focus_train" && !scope.hasTrain(action.serviceUid)) {
    return outOfScope("同じタスクで検証された列車ではありません");
  }
  if (action.type === "highlight_route" && !scope.hasJourney(action.journeyId)) {
    return outOfScope("同じタスクで検証された経路ではありません");
  }
  if (
    action.type === "compare_journeys" &&
    action.journeyIds.some((journeyId) => !scope.hasJourney(journeyId))
  ) {
    return outOfScope("比較対象に未検証の経路が含まれています");
  }
  if (
    action.type === "show_evidence" &&
    action.evidenceIds.some((evidenceId) => !scope.hasEvidence(evidenceId))
  ) {
    return outOfScope("表示対象に未検証のEvidenceが含まれています");
  }
  return { ok: true, effect: "display_only" };
}

export function viewerActionTarget(action: ViewerAgentAction): string | undefined {
  if (action.type === "focus_train") return action.serviceUid;
  if (action.type === "highlight_route") return action.journeyId;
  if (action.type === "compare_journeys") return action.journeyIds.join(",");
  if (action.type === "show_evidence") return action.evidenceIds.join(",");
  return undefined;
}

function outOfScope(reason: string): ViewerActionPolicyResult {
  return { ok: false, code: "entity_out_of_scope", reason };
}
