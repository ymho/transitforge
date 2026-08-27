import { Buffer } from "node:buffer";

import type { LambdaHttpEvent } from "./http.js";

export const agentRequestContractVersion = "agent-api-request-v1";
export const maximumBodyBytes = 32 * 1_024;
const maximumMessages = 16;
const maximumContentBlocks = 12;
const maximumTextCharacters = 4_000;
const maximumToolDefinitions = 20;

export const allowedToolNames = new Set([
  "set_display_time",
  "search_trains",
  "query_daily_congestion_analysis",
  "search_direct_routes",
  "search_train_arrivals",
  "search_representative_timetable",
  "query_train_delay_analysis",
  "search_accommodations",
  "plan_day_trip",
  "search_trip_route_update",
  "ask_follow_up",
  "remember_travel_preference",
  "update_conversation_session",
  "propose_trip_update",
  "focus_train",
  "set_weather",
  "set_layer_visibility",
  "search_journeys",
  "inspect_train",
  "inspect_station",
  "get_route_details",
  "analyze_delay",
  "analyze_congestion",
  "compare_journeys",
]);

export class RequestError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
    this.name = "RequestError";
  }
}

export type JsonObject = Record<string, unknown>;

export interface AgentMessage {
  role: "user" | "assistant";
  content: Array<
    | { text: string }
    | { toolUse: { toolUseId: string; name: string; input: JsonObject } }
    | {
        toolResult: {
          toolUseId: string;
          status: "success" | "error";
          content: [{ json: unknown }];
        };
      }
  >;
}

export interface AgentToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonObject & { type: "object"; properties: JsonObject };
}

export function requestValue(event: LambdaHttpEvent): JsonObject {
  if (event.requestContext?.http?.method !== "POST") {
    throw new RequestError(405, "POSTのみ利用できます。");
  }
  if (typeof event.body !== "string") {
    throw new RequestError(400, "リクエスト本文が必要です。");
  }
  const bytes = event.isBase64Encoded === true
    ? strictBase64Decode(event.body)
    : Buffer.from(event.body, "utf8");
  if (bytes.byteLength > maximumBodyBytes) {
    throw new RequestError(413, "リクエストが大きすぎます。");
  }
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new RequestError(400, "JSON形式のリクエストが必要です。");
  }
  let value: unknown;
  try {
    value = JSON.parse(decoded);
  } catch {
    throw new RequestError(400, "JSON形式のリクエストが必要です。");
  }
  if (!isRecord(value) || Array.isArray(value)) {
    throw new RequestError(400, "リクエストの形式が不正です。");
  }
  return value;
}

export function validatedMessages(value: JsonObject): AgentMessage[] {
  const messages = value.messages;
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > maximumMessages) {
    throw new RequestError(400, "messagesの件数が不正です。");
  }
  return messages.map(validatedMessage);
}

export function validatedToolDefinitions(
  value: JsonObject,
): AgentToolDefinition[] | undefined {
  const definitions = value.toolDefinitions;
  if (definitions === undefined) return undefined;
  if (
    !Array.isArray(definitions) ||
    definitions.length < 1 ||
    definitions.length > maximumToolDefinitions
  ) {
    throw new RequestError(400, "toolDefinitionsの件数が不正です。");
  }
  const names = new Set<string>();
  return definitions.map((definition) => {
    if (!isRecord(definition)) {
      throw new RequestError(400, "toolDefinitionの形式が不正です。");
    }
    const { name, description, inputSchema } = definition;
    if (
      typeof name !== "string" ||
      !allowedToolNames.has(name) ||
      names.has(name) ||
      typeof description !== "string" ||
      description.length < 1 ||
      description.length > 500 ||
      !isRecord(inputSchema) ||
      inputSchema.type !== "object" ||
      !isRecord(inputSchema.properties)
    ) {
      throw new RequestError(400, "toolDefinitionが許可されていません。");
    }
    names.add(name);
    return {
      name,
      description,
      inputSchema: inputSchema as AgentToolDefinition["inputSchema"],
    };
  });
}

function validatedMessage(value: unknown): AgentMessage {
  if (!isRecord(value) || (value.role !== "user" && value.role !== "assistant")) {
    throw new RequestError(400, "messageのroleが不正です。");
  }
  if (
    !Array.isArray(value.content) ||
    value.content.length < 1 ||
    value.content.length > maximumContentBlocks
  ) {
    throw new RequestError(400, "messageのcontentが不正です。");
  }
  const role = value.role;
  return {
    role,
    content: value.content.map((block) => validatedContentBlock(block, role)),
  };
}

function validatedContentBlock(
  value: unknown,
  role: AgentMessage["role"],
): AgentMessage["content"][number] {
  if (!isRecord(value) || Object.keys(value).length !== 1) {
    throw new RequestError(400, "content blockの形式が不正です。");
  }
  if (
    typeof value.text === "string" &&
    value.text.length > 0 &&
    value.text.length <= maximumTextCharacters
  ) {
    return { text: value.text };
  }
  if (role === "assistant" && isRecord(value.toolUse)) {
    const { toolUseId, name, input } = value.toolUse;
    if (
      typeof toolUseId === "string" &&
      typeof name === "string" &&
      allowedToolNames.has(name) &&
      isRecord(input)
    ) {
      return { toolUse: { toolUseId: toolUseId.slice(0, 128), name, input } };
    }
  }
  if (role === "user" && isRecord(value.toolResult)) {
    const { toolUseId, status, content } = value.toolResult;
    if (
      typeof toolUseId === "string" &&
      (status === "success" || status === "error") &&
      validToolResultContent(content)
    ) {
      return {
        toolResult: {
          toolUseId: toolUseId.slice(0, 128),
          status,
          content,
        },
      };
    }
  }
  throw new RequestError(400, "許可されていないcontent blockです。");
}

function validToolResultContent(value: unknown): value is [{ json: unknown }] {
  if (
    !Array.isArray(value) ||
    value.length !== 1 ||
    !isRecord(value[0]) ||
    Object.keys(value[0]).length !== 1 ||
    !("json" in value[0])
  ) return false;
  try {
    const encoded = JSON.stringify(value[0].json);
    return encoded !== undefined && encoded.length <= 8_000;
  } catch {
    return false;
  }
}

function strictBase64Decode(value: string): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    throw new RequestError(400, "リクエスト本文を読み取れません。");
  }
  return Buffer.from(value, "base64");
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
