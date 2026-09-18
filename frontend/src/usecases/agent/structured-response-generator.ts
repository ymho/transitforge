import { parseViewerAgentActions } from "../viewer/viewer-action";
import type { Evidence, EvidenceClaim } from "./evidence-model";
import type { AgentModelResponse } from "./model-provider";
import {
  DefaultAgentResponseGenerator,
  type AgentGeneratedResponse,
} from "./agent-response-generator";

export class StructuredAgentResponseGenerator extends DefaultAgentResponseGenerator {
  override fromModel(
    response: AgentModelResponse,
    _evidence: Evidence[],
  ): AgentGeneratedResponse {
    const text = response.message.content
      .filter((content): content is { type: "text"; text: string } =>
        content.type === "text")
      .map(({ text: contentText }) => contentText)
      .join("");
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error("Agent応答が構造化JSONではありません");
    }
    if (!isRecord(value) || Object.keys(value).some((key) =>
      key !== "text" && key !== "claims" && key !== "viewerActions")) {
      throw new Error("Agent応答のfieldが不正です");
    }
    if (typeof value.text !== "string" || !value.text.trim() || value.text.length > 4_000) {
      throw new Error("Agent応答本文が不正です");
    }
    if (!Array.isArray(value.claims) || value.claims.length > 20) {
      throw new Error("Agent応答Claimの件数が不正です");
    }
    if (!Array.isArray(value.viewerActions) || value.viewerActions.length > 10) {
      throw new Error("Agent応答Viewer Actionの件数が不正です");
    }
    return {
      text: value.text.trim(),
      claims: value.claims.map(parseClaim),
      viewerActions: parseViewerAgentActions(value.viewerActions),
    };
  }
}

function parseClaim(value: unknown, index: number): EvidenceClaim {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) =>
      key !== "id" && key !== "statement" && key !== "kind" && key !== "evidenceIds") ||
    !isIdentifier(value.id) ||
    typeof value.statement !== "string" ||
    !value.statement.trim() ||
    value.statement.length > 500 ||
    (value.kind !== "fact" && value.kind !== "inference" && value.kind !== "unknown") ||
    !Array.isArray(value.evidenceIds) ||
    value.evidenceIds.length > 10 ||
    !value.evidenceIds.every(isIdentifier) ||
    new Set(value.evidenceIds).size !== value.evidenceIds.length
  ) {
    throw new Error(`Agent応答Claim ${index + 1}件目が不正です`);
  }
  return {
    id: value.id,
    statement: value.statement.trim(),
    kind: value.kind,
    evidenceIds: [...value.evidenceIds],
  };
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 200;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
