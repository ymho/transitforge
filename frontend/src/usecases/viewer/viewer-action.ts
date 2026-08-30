export type ViewerAgentLayer = "congestion" | "destination_arcs";

export type ViewerAgentAction =
  | {
      type: "set_display_time";
      routeTimeMinutes: number;
    }
  | {
      type: "focus_train";
      serviceUid: string;
    }
  | {
      type: "highlight_route";
      journeyId: string;
    }
  | {
      type: "compare_journeys";
      journeyIds: string[];
    }
  | {
      type: "show_evidence";
      evidenceIds: string[];
    }
  | {
      type: "set_layer_visibility";
      layer: ViewerAgentLayer;
      visible: boolean;
    };

export function parseViewerAgentActions(value: unknown): ViewerAgentAction[] {
  if (!Array.isArray(value)) {
    throw new Error("AIの画面操作は配列である必要があります。");
  }

  return value.map((action, index) => {
    if (!isRecord(action) || typeof action.type !== "string") {
      throw invalidAction(index);
    }

    switch (action.type) {
      case "set_display_time":
        if (
          hasOnlyFields(action, ["type", "routeTimeMinutes"]) &&
          typeof action.routeTimeMinutes === "number" &&
          Number.isFinite(action.routeTimeMinutes) &&
          action.routeTimeMinutes >= 0
        ) {
          return {
            type: action.type,
            routeTimeMinutes: action.routeTimeMinutes,
          };
        }
        break;
      case "focus_train":
        if (
          hasOnlyFields(action, ["type", "serviceUid"]) &&
          isBoundedIdentifier(action.serviceUid)
        ) {
          return {
            type: action.type,
            serviceUid: action.serviceUid,
          };
        }
        break;
      case "highlight_route":
        if (
          hasOnlyFields(action, ["type", "journeyId"]) &&
          isBoundedIdentifier(action.journeyId)
        ) {
          return { type: action.type, journeyId: action.journeyId };
        }
        break;
      case "compare_journeys":
        if (
          hasOnlyFields(action, ["type", "journeyIds"]) &&
          isIdentifierList(action.journeyIds, 2, 3)
        ) {
          return { type: action.type, journeyIds: [...action.journeyIds] };
        }
        break;
      case "show_evidence":
        if (
          hasOnlyFields(action, ["type", "evidenceIds"]) &&
          isIdentifierList(action.evidenceIds, 1, 10)
        ) {
          return { type: action.type, evidenceIds: [...action.evidenceIds] };
        }
        break;
      case "set_layer_visibility":
        if (
          hasOnlyFields(action, ["type", "layer", "visible"]) &&
          (action.layer === "congestion" ||
            action.layer === "destination_arcs") &&
          typeof action.visible === "boolean"
        ) {
          return {
            type: action.type,
            layer: action.layer,
            visible: action.visible,
          };
        }
        break;
    }

    throw invalidAction(index);
  });
}

function invalidAction(index: number): Error {
  return new Error(`AIの画面操作 ${index + 1} 件目が不正です。`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyFields(value: Record<string, unknown>, fields: string[]): boolean {
  const allowed = new Set(fields);
  return Object.keys(value).every((field) => allowed.has(field));
}

function isBoundedIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 160;
}

function isIdentifierList(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string[] {
  return Array.isArray(value) &&
    value.length >= minimum &&
    value.length <= maximum &&
    value.every(isBoundedIdentifier) &&
    new Set(value).size === value.length;
}
