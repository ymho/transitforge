import {
  maximumRouteDetailStops,
  type NetworkInspectionErrorCode,
  type NetworkInspectionResult,
  type NetworkInspectionService,
  type RouteDetails,
  type StationInspection,
  type TrainInspection,
} from "../network-inspection-service";
import {
  failedAgentToolResult,
  invalidAgentToolInput,
  successfulAgentToolResult,
  validAgentToolInput,
  type AgentTool,
  type AgentToolInputResult,
  type AgentToolResult,
} from "./tool-contract";

export const maximumInspectionToolPayloadBytes = 48 * 1_024;

interface InspectTrainInput {
  serviceUid: string;
}

interface InspectStationInput {
  stationName: string;
}

interface GetRouteDetailsInput {
  serviceUid: string;
  originStation?: string;
  destinationStation?: string;
  offset?: number;
  limit?: number;
}

export function createInspectTrainTool(
  service: NetworkInspectionService,
): AgentTool<InspectTrainInput, TrainInspection> {
  return {
    name: "inspect_train",
    description: "検証済みserviceUidから列車の計画上の概要を取得します",
    inputSchema: {
      type: "object",
      properties: { serviceUid: { type: "string", maxLength: 160 } },
      required: ["serviceUid"],
      additionalProperties: false,
    },
    parseInput: (value) => parseSingleTextInput(value, "serviceUid"),
    execute: async ({ serviceUid }) => boundedInspectionResult(
      service.inspectTrain(serviceUid),
    ),
  };
}

export function createInspectStationTool(
  service: NetworkInspectionService,
): AgentTool<InspectStationInput, StationInspection> {
  return {
    name: "inspect_station",
    description: "時刻表と駅路線カタログから駅の路線と計画列車の概要を取得します",
    inputSchema: {
      type: "object",
      properties: { stationName: { type: "string", maxLength: 160 } },
      required: ["stationName"],
      additionalProperties: false,
    },
    parseInput: (value) => parseSingleTextInput(value, "stationName"),
    execute: async ({ stationName }) => boundedInspectionResult(
      service.inspectStation(stationName),
    ),
  };
}

export function createGetRouteDetailsTool(
  service: NetworkInspectionService,
): AgentTool<GetRouteDetailsInput, RouteDetails> {
  return {
    name: "get_route_details",
    description: "検証済みserviceUidの停車駅と計画時刻を上限付きで取得します",
    inputSchema: {
      type: "object",
      properties: {
        serviceUid: { type: "string", maxLength: 160 },
        originStation: { type: "string", maxLength: 160 },
        destinationStation: { type: "string", maxLength: 160 },
        offset: { type: "integer", minimum: 0 },
        limit: { type: "integer", minimum: 1, maximum: maximumRouteDetailStops },
      },
      required: ["serviceUid"],
      additionalProperties: false,
    },
    parseInput: parseRouteDetailsInput,
    execute: async (input) => boundedInspectionResult(
      service.getRouteDetails(input),
    ),
  };
}

function parseSingleTextInput<Key extends "serviceUid" | "stationName">(
  value: unknown,
  key: Key,
): AgentToolInputResult<Record<Key, string>> {
  if (!isRecord(value) || Object.keys(value).some((field) => field !== key)) {
    return invalidAgentToolInput(`${key}だけを指定してください`);
  }
  if (!isBoundedText(value[key])) {
    return invalidAgentToolInput(`${key}を指定してください`);
  }
  return validAgentToolInput({ [key]: value[key] } as Record<Key, string>);
}

function parseRouteDetailsInput(
  value: unknown,
): AgentToolInputResult<GetRouteDetailsInput> {
  if (!isRecord(value)) {
    return invalidAgentToolInput("経路詳細の条件はオブジェクトで指定してください");
  }
  const allowed = new Set([
    "serviceUid",
    "originStation",
    "destinationStation",
    "offset",
    "limit",
  ]);
  if (Object.keys(value).some((field) => !allowed.has(field))) {
    return invalidAgentToolInput("未対応の経路詳細条件が含まれています");
  }
  if (!isBoundedText(value.serviceUid)) {
    return invalidAgentToolInput("serviceUidを指定してください");
  }
  if (
    (value.originStation !== undefined && !isBoundedText(value.originStation)) ||
    (value.destinationStation !== undefined && !isBoundedText(value.destinationStation))
  ) {
    return invalidAgentToolInput("駅名が不正です");
  }
  if (!isOptionalInteger(value.offset, 0, Number.MAX_SAFE_INTEGER)) {
    return invalidAgentToolInput("offsetは0以上の整数で指定してください");
  }
  if (!isOptionalInteger(value.limit, 1, maximumRouteDetailStops)) {
    return invalidAgentToolInput(`limitは1から${maximumRouteDetailStops}で指定してください`);
  }
  return validAgentToolInput(value as unknown as GetRouteDetailsInput);
}

function boundedInspectionResult<T>(
  result: NetworkInspectionResult<T>,
): AgentToolResult<T> {
  if (!result.ok) {
    return failedAgentToolResult({
      code: toolErrorCode(result.error.code),
      message: result.error.message,
      retryable: false,
    });
  }
  if (payloadBytes(result.value) > maximumInspectionToolPayloadBytes) {
    return failedAgentToolResult({
      code: "execution_failed",
      message: "照会結果がToolの上限を超えました",
      retryable: false,
    });
  }
  return successfulAgentToolResult(result.value);
}

function toolErrorCode(
  code: NetworkInspectionErrorCode,
): "not_found" | "ambiguous_entity" | "invalid_input" {
  if (code === "invalid_range") return "invalid_input";
  return code;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 160;
}

function isOptionalInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): boolean {
  return value === undefined || (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function payloadBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
