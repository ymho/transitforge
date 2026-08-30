import type { AgentContextValue } from "./agent-decision-context";

export const decisionSummaryStartTag = "<decision_summary>";
export const decisionSummaryEndTag = "</decision_summary>";

export const agentDecisionReasonCodes = [
  "goal_interpreted",
  "constraint_applied",
  "preference_considered",
  "evidence_required",
  "evidence_sufficient",
  "information_missing",
  "tool_result_changed_plan",
  "tool_unavailable",
  "tool_failed",
  "safety_boundary",
  "user_confirmation_required",
  "no_factual_claim_required",
] as const;

export const agentReplanReasonCodes = [
  "tool_result_received",
  "tool_failed",
  "evidence_insufficient",
  "constraint_conflict",
  "new_information",
] as const;

export type AgentDecisionReasonCode = typeof agentDecisionReasonCodes[number];
export type AgentReplanReasonCode = typeof agentReplanReasonCodes[number];

export interface AgentDecisionSummaryValue {
  key: string;
  value: AgentContextValue;
}

export interface AgentDecisionSummary {
  interpretedGoal: string;
  hardConstraints: AgentDecisionSummaryValue[];
  softPreferences: AgentDecisionSummaryValue[];
  selectedAction: "use_tool" | "ask_user" | "answer";
  selectedTool?: string;
  unresolvedFacts: string[];
  reasonCodes: AgentDecisionReasonCode[];
  replanReason?: AgentReplanReasonCode;
}

export interface ExtractedAgentDecisionSummary {
  status: "valid" | "missing" | "invalid";
  summary?: AgentDecisionSummary;
  textBlocks: string[];
}

const summaryPattern = /<decision_summary>([\s\S]*?)<\/decision_summary>/gu;
const identifierPattern = /^[a-z][a-z0-9_]{0,63}$/u;
const maximumSummaryCharacters = 2_048;

export function extractAgentDecisionSummary(
  textBlocks: string[],
): ExtractedAgentDecisionSummary {
  const matches = textBlocks.flatMap((text) => [...text.matchAll(summaryPattern)]);
  const cleaned = textBlocks.map((text) => text.replace(summaryPattern, "").trim());
  if (matches.length === 0) return { status: "missing", textBlocks: cleaned };
  if (matches.length !== 1) return { status: "invalid", textBlocks: cleaned };
  const encoded = matches[0]?.[1]?.trim() ?? "";
  if (!encoded || encoded.length > maximumSummaryCharacters) {
    return { status: "invalid", textBlocks: cleaned };
  }
  try {
    const summary = parseAgentDecisionSummary(JSON.parse(encoded));
    return summary
      ? { status: "valid", summary, textBlocks: cleaned }
      : { status: "invalid", textBlocks: cleaned };
  } catch {
    return { status: "invalid", textBlocks: cleaned };
  }
}

export function parseAgentDecisionSummary(value: unknown): AgentDecisionSummary | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "interpretedGoal", "hardConstraints", "softPreferences", "selectedAction",
    "selectedTool", "unresolvedFacts", "reasonCodes", "replanReason",
  ])) return undefined;
  if (!boundedText(value.interpretedGoal, 240) ||
    !decisionValues(value.hardConstraints, 12) ||
    !decisionValues(value.softPreferences, 12) ||
    !["use_tool", "ask_user", "answer"].includes(String(value.selectedAction)) ||
    value.selectedTool !== undefined && !identifier(value.selectedTool) ||
    !identifierList(value.unresolvedFacts, 8) ||
    !enumList(value.reasonCodes, agentDecisionReasonCodes, 6) ||
    value.replanReason !== undefined &&
      !agentReplanReasonCodes.includes(value.replanReason as AgentReplanReasonCode)) {
    return undefined;
  }
  if (value.selectedAction === "use_tool" && value.selectedTool === undefined) return undefined;
  if (value.selectedAction === "answer" && value.selectedTool !== undefined) return undefined;
  return {
    interpretedGoal: value.interpretedGoal,
    hardConstraints: value.hardConstraints,
    softPreferences: value.softPreferences,
    selectedAction: value.selectedAction,
    ...(value.selectedTool ? { selectedTool: value.selectedTool } : {}),
    unresolvedFacts: value.unresolvedFacts,
    reasonCodes: value.reasonCodes,
    ...(value.replanReason ? { replanReason: value.replanReason } : {}),
  } as AgentDecisionSummary;
}

function decisionValues(value: unknown, maximum: number): value is AgentDecisionSummaryValue[] {
  return Array.isArray(value) && value.length <= maximum && value.every((item) =>
    isRecord(item) && hasOnlyKeys(item, ["key", "value"]) && identifier(item.key) &&
    (item.value === null || typeof item.value === "string" && item.value.length <= 240 ||
      typeof item.value === "number" && Number.isFinite(item.value) ||
      typeof item.value === "boolean"));
}

function identifierList(value: unknown, maximum: number): value is string[] {
  return Array.isArray(value) && value.length <= maximum && value.every(identifier);
}

function enumList<T extends string>(
  value: unknown,
  allowed: readonly T[],
  maximum: number,
): value is T[] {
  return Array.isArray(value) && value.length <= maximum &&
    value.every((item) => typeof item === "string" && allowed.includes(item as T));
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && identifierPattern.test(value);
}

function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim() === value &&
    value.length > 0 && value.length <= maximum;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}
