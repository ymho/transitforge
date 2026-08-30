import type { AgentToolDescriptor } from "./tool-contract";
import type { AgentRuntimeFeature, AgentRuntimeRequest } from "./runtime-contract";

export type AgentContextValue = string | number | boolean | null;

export interface AgentKnownConstraint {
  key: string;
  value: AgentContextValue;
  source: "user" | "conversation" | "trip_context" | "current_trip" | "ui";
}

export interface AgentKnownPreference {
  key: string;
  value: AgentContextValue;
  source: "user" | "conversation" | "travel_profile" | "trip_context";
}

export interface AgentConversationContext {
  summary?: string;
  relevantMessages?: string[];
  resolvedTopics?: string[];
  pendingTopics?: string[];
}

export interface AgentFeatureContext {
  feature: AgentRuntimeFeature;
  displayTimeMinutes?: number;
  calendarDate?: string;
  serviceDate?: string;
}

export interface AgentVerifiedFactSummary {
  evidenceId: string;
  category: string;
  subject: string;
  summary: string;
}

export interface AgentToolOutcomeSummary {
  toolName: string;
  outcome: "success" | "error";
  summary: string;
}

export interface AgentRuntimeContextInput {
  personaInstruction?: string;
  featureContext?: Omit<AgentFeatureContext, "feature">;
  conversation?: AgentConversationContext;
  tripContext?: Record<string, AgentContextValue | AgentContextValue[]>;
  travelProfile?: Record<string, unknown>;
  currentTrip?: Record<string, unknown>;
  verifiedFacts?: AgentVerifiedFactSummary[];
  knownHardConstraints?: AgentKnownConstraint[];
  knownSoftPreferences?: AgentKnownPreference[];
  previousToolOutcomes?: AgentToolOutcomeSummary[];
}

export interface AgentAvailableCapability {
  name: string;
  description: string;
  requiredInputs: string[];
}

export interface AgentDecisionContext {
  userRequest: string;
  featureContext: AgentFeatureContext;
  personaInstruction?: string;
  conversation?: AgentConversationContext;
  tripContext?: Record<string, AgentContextValue | AgentContextValue[]>;
  travelProfile?: Record<string, unknown>;
  currentTrip?: Record<string, unknown>;
  verifiedFacts: AgentVerifiedFactSummary[];
  knownHardConstraints: AgentKnownConstraint[];
  knownSoftPreferences: AgentKnownPreference[];
  previousToolOutcomes: AgentToolOutcomeSummary[];
  availableTools: AgentAvailableCapability[];
}

const maximumContextTextLength = 3_600;

export function buildAgentDecisionContext(
  request: AgentRuntimeRequest,
  tools: AgentToolDescriptor[],
): AgentDecisionContext {
  const input = request.context;
  return {
    userRequest: bounded(request.userRequest, 1_500),
    featureContext: {
      feature: request.feature,
      ...(finite(input?.featureContext?.displayTimeMinutes)
        ? { displayTimeMinutes: input.featureContext.displayTimeMinutes }
        : {}),
      ...(date(input?.featureContext?.calendarDate)
        ? { calendarDate: input?.featureContext?.calendarDate }
        : {}),
      ...(date(input?.featureContext?.serviceDate)
        ? { serviceDate: input?.featureContext?.serviceDate }
        : {}),
    },
    ...(text(input?.personaInstruction, 800)
      ? { personaInstruction: text(input?.personaInstruction, 800) }
      : {}),
    ...(input?.conversation ? { conversation: conversation(input.conversation) } : {}),
    ...(input?.tripContext ? { tripContext: boundedRecord(input.tripContext, 20) } : {}),
    ...(input?.travelProfile ? { travelProfile: boundedUnknownRecord(input.travelProfile) } : {}),
    ...(input?.currentTrip ? { currentTrip: boundedUnknownRecord(input.currentTrip) } : {}),
    verifiedFacts: (input?.verifiedFacts ?? []).slice(0, 20).map((fact) => ({
      evidenceId: bounded(fact.evidenceId, 160),
      category: bounded(fact.category, 80),
      subject: bounded(fact.subject, 160),
      summary: bounded(fact.summary, 300),
    })),
    knownHardConstraints: (input?.knownHardConstraints ?? []).slice(0, 20)
      .map(constraint),
    knownSoftPreferences: (input?.knownSoftPreferences ?? []).slice(0, 20)
      .map(preference),
    previousToolOutcomes: (input?.previousToolOutcomes ?? []).slice(-12)
      .map((outcome) => ({
        toolName: bounded(outcome.toolName, 80),
        outcome: outcome.outcome,
        summary: bounded(outcome.summary, 300),
      })),
    availableTools: tools.slice(0, 40).map((tool) => ({
      name: tool.name,
      description: bounded(tool.description, 500),
      requiredInputs: [...(tool.inputSchema.required ?? [])].slice(0, 20),
    })),
  };
}

export function agentDecisionContextText(context: AgentDecisionContext): string {
  const serialized = JSON.stringify({
    ...context,
    availableTools: context.availableTools.map(({ name, requiredInputs }) => ({
      name,
      requiredInputs,
    })),
  });
  const compact = JSON.stringify({
      userRequest: context.userRequest,
      featureContext: context.featureContext,
      conversation: context.conversation ? {
        summary: context.conversation.summary,
        relevantMessages: context.conversation.relevantMessages?.slice(-2),
        pendingTopics: context.conversation.pendingTopics,
      } : undefined,
      tripContext: context.tripContext,
      travelProfile: context.travelProfile,
      currentTrip: compactCurrentTrip(context.currentTrip),
      knownHardConstraints: context.knownHardConstraints,
      knownSoftPreferences: context.knownSoftPreferences,
      availableTools: context.availableTools.map(({ name }) => name),
      contextTruncated: true,
    });
  const core = JSON.stringify({
    userRequest: context.userRequest.slice(0, 1_000),
    featureContext: context.featureContext,
    tripContext: context.tripContext,
    travelProfile: context.travelProfile,
    currentTrip: compactCurrentTrip(context.currentTrip, 4),
    knownHardConstraints: context.knownHardConstraints.slice(0, 12),
    knownSoftPreferences: context.knownSoftPreferences.slice(0, 12),
    availableTools: context.availableTools.slice(0, 16).map(({ name }) => name),
    contextTruncated: true,
  });
  const boundedContext = serialized.length <= maximumContextTextLength
    ? serialized
    : compact.length <= maximumContextTextLength ? compact : core;
  return [
    "次の構造化Contextを使って利用者の目的と制約を解釈し、必要なEvidenceを得る能力を選択してください。",
    "既知条件は聞き直さず、Tool結果は事実として扱い、推測で補完しないでください。",
    `<agent_context>${boundedContext}</agent_context>`,
  ].join("\n");
}

function compactCurrentTrip(
  value: Record<string, unknown> | undefined,
  maximumScheduleItems = 8,
): Record<string, unknown> | undefined {
  if (!value) return undefined;
  return {
    ...(value.title ? { title: value.title } : {}),
    ...(value.destination ? { destination: value.destination } : {}),
    ...(value.adults !== undefined ? { adults: value.adults } : {}),
    ...(value.children !== undefined ? { children: value.children } : {}),
    ...(Array.isArray(value.considerations)
      ? { considerations: value.considerations.slice(0, 6) }
      : {}),
    ...(Array.isArray(value.schedule)
      ? { schedule: value.schedule.slice(0, maximumScheduleItems) }
      : {}),
  };
}

function conversation(value: AgentConversationContext): AgentConversationContext {
  return {
    ...(text(value.summary, 800) ? { summary: text(value.summary, 800) } : {}),
    relevantMessages: texts(value.relevantMessages, 8, 500),
    resolvedTopics: texts(value.resolvedTopics, 12, 120),
    pendingTopics: texts(value.pendingTopics, 12, 120),
  };
}

function constraint(value: AgentKnownConstraint): AgentKnownConstraint {
  return {
    key: bounded(value.key, 80),
    value: boundedValue(value.value),
    source: value.source,
  };
}

function preference(value: AgentKnownPreference): AgentKnownPreference {
  return {
    key: bounded(value.key, 80),
    value: boundedValue(value.value),
    source: value.source,
  };
}

function boundedRecord(
  value: Record<string, AgentContextValue | AgentContextValue[]>,
  maximumEntries: number,
): Record<string, AgentContextValue | AgentContextValue[]> {
  return Object.fromEntries(Object.entries(value).slice(0, maximumEntries).map(([key, item]) => [
    bounded(key, 80),
    Array.isArray(item)
      ? item.slice(0, 12).map(boundedValue)
      : boundedValue(item),
  ]));
}

function boundedUnknownRecord(value: Record<string, unknown>): Record<string, unknown> {
  return boundedUnknown(value, 0) as Record<string, unknown>;
}

function boundedUnknown(value: unknown, depth: number): unknown {
  if (depth >= 4) return "[depth-limited]";
  if (typeof value === "string") return bounded(value, 300);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => boundedUnknown(item, depth + 1));
  if (!value || typeof value !== "object") return null;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !/(?:token|secret|password|credential|api[_-]?key|latitude|longitude|coordinates?)/iu.test(key))
    .slice(0, 30)
    .map(([key, item]) => [bounded(key, 80), boundedUnknown(item, depth + 1)]));
}

function boundedValue(value: AgentContextValue): AgentContextValue {
  return typeof value === "string" ? bounded(value, 300) : value;
}

function texts(values: string[] | undefined, maximumItems: number, maximumLength: number): string[] {
  return (values ?? []).slice(0, maximumItems).flatMap((value) => {
    const result = text(value, maximumLength);
    return result ? [result] : [];
  });
}

function text(value: string | undefined, maximum: number): string | undefined {
  const result = value?.normalize("NFKC").replace(/\s+/gu, " ").trim();
  return result ? result.slice(0, maximum) : undefined;
}

function bounded(value: string, maximum: number): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, maximum);
}

function finite(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function date(value: string | undefined): boolean {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value);
}
