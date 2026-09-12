import type { AgentToolDescriptor } from "./tool-contract";
import type { AgentRuntimeFeature, AgentRuntimeRequest } from "./runtime-contract";

export type AgentContextValue = string | number | boolean | null;

export interface AgentKnownConstraint {
  key: string;
  value: AgentContextValue;
  source: "user" | "conversation" | "trip_context" | "current_trip" | "ui" |
    "agent_interpretation";
}

export interface AgentKnownPreference {
  key: string;
  value: AgentContextValue;
  source: "user" | "conversation" | "travel_profile" | "trip_context" |
    "agent_interpretation";
}

export interface AgentConversationContext {
  summary?: string;
  messages?: Array<{ role: "user" | "assistant"; text: string }>;
  /** Legacy notes; serialized conversations are decoded before bounding. */
  relevantMessages?: string[];
  resolvedTopics?: string[];
  pendingTopics?: string[];
}

export interface AgentFeatureContext {
  feature: AgentRuntimeFeature;
  displayTimeMinutes?: number;
  calendarDate?: string;
  serviceDate?: string;
  /** Calendar arithmetic only; these references are not selected travel dates. */
  relativeDates?: { today: string; tomorrow: string; dayAfterTomorrow: string };
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
  travelCandidates?: Record<string, unknown>[];
  realtimeFacts?: Record<string, unknown>[];
  featureContext?: Omit<AgentFeatureContext, "feature">;
  conversation?: AgentConversationContext;
  tripContext?: Record<string, AgentContextValue | AgentContextValue[]>;
  travelProfile?: Record<string, unknown>;
  currentTrip?: Record<string, unknown>;
  currentJourney?: Record<string, unknown>;
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
  travelCandidates?: Record<string, unknown>[];
  realtimeFacts?: Record<string, unknown>[];
  userRequest: string;
  featureContext: AgentFeatureContext;
  conversation?: AgentConversationContext;
  tripContext?: Record<string, AgentContextValue | AgentContextValue[]>;
  travelProfile?: Record<string, unknown>;
  currentTrip?: Record<string, unknown>;
  currentJourney?: Record<string, unknown>;
  verifiedFacts: AgentVerifiedFactSummary[];
  knownHardConstraints: AgentKnownConstraint[];
  knownSoftPreferences: AgentKnownPreference[];
  previousToolOutcomes: AgentToolOutcomeSummary[];
  availableTools: AgentAvailableCapability[];
}

const maximumContextTextLength = 24_000;

export function buildAgentDecisionContext(
  request: AgentRuntimeRequest,
  tools: AgentToolDescriptor[],
): AgentDecisionContext {
  const input = request.context;
  return {
    userRequest: bounded(request.userRequest, 1_500),
    ...(input?.travelCandidates ? { travelCandidates: input.travelCandidates.slice(0, 12).map((value) => boundedUnknownRecord(value)) } : {}),
    ...(input?.realtimeFacts ? { realtimeFacts: input.realtimeFacts.slice(0, 12).map((value) => boundedUnknownRecord(value)) } : {}),
    featureContext: {
      feature: request.feature,
      ...(finite(input?.featureContext?.displayTimeMinutes)
        ? { displayTimeMinutes: input.featureContext.displayTimeMinutes }
        : {}),
      ...(date(input?.featureContext?.calendarDate)
        ? { calendarDate: input?.featureContext?.calendarDate,
            ...calendarDateReferences(input?.featureContext?.calendarDate) }
        : {}),
      ...(date(input?.featureContext?.serviceDate)
        ? { serviceDate: input?.featureContext?.serviceDate }
        : {}),
    },
    ...(input?.conversation ? { conversation: conversation(input.conversation) } : {}),
    ...(input?.tripContext ? { tripContext: boundedRecord(input.tripContext, 20) } : {}),
    ...(input?.travelProfile ? { travelProfile: boundedUnknownRecord(input.travelProfile) } : {}),
    ...(input?.currentTrip ? { currentTrip: boundedUnknownRecord(input.currentTrip) } : {}),
    ...(input?.currentJourney
      ? { currentJourney: boundedUnknownRecord(input.currentJourney, 6) }
      : {}),
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
      description: tool.description,
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
        messages: context.conversation.messages?.slice(-8),
        relevantMessages: context.conversation.relevantMessages?.slice(-2),
        pendingTopics: context.conversation.pendingTopics,
      } : undefined,
      tripContext: context.tripContext,
      travelProfile: context.travelProfile,
      currentTrip: compactCurrentTrip(context.currentTrip),
      travelCandidates: context.travelCandidates?.slice(0, 4),
      realtimeFacts: context.realtimeFacts?.slice(0, 4),
      currentJourney: compactCurrentJourney(context.currentJourney, 2),
      knownHardConstraints: context.knownHardConstraints,
      knownSoftPreferences: context.knownSoftPreferences,
      availableTools: context.availableTools.map(({ name }) => name),
      contextTruncated: true,
    });
  const core = JSON.stringify({
    userRequest: context.userRequest.slice(0, 1_000),
    featureContext: context.featureContext,
    conversation: context.conversation ? {
      ...context.conversation,
      messages: context.conversation.messages?.slice(-4),
    } : undefined,
    tripContext: context.tripContext,
    travelProfile: context.travelProfile,
    currentTrip: compactCurrentTrip(context.currentTrip, 4),
    travelCandidates: context.travelCandidates?.slice(0, 2),
    realtimeFacts: context.realtimeFacts?.slice(0, 2),
    currentJourney: compactCurrentJourney(context.currentJourney),
    knownHardConstraints: context.knownHardConstraints.slice(0, 12),
    knownSoftPreferences: context.knownSoftPreferences.slice(0, 12),
    availableTools: context.availableTools.slice(0, 16).map(({ name }) => name),
    contextTruncated: true,
  });
  const minimal = JSON.stringify({
    userRequest: context.userRequest,
    featureContext: context.featureContext,
    conversation: context.conversation ? {
      summary: context.conversation.summary,
      messages: context.conversation.messages?.slice(-4).map(({ role, text }) => ({ role, text: text.slice(0, 800) })),
      pendingTopics: context.conversation.pendingTopics,
    } : undefined,
    tripContext: context.tripContext ? Object.fromEntries(Object.entries(context.tripContext).slice(0, 20)
      .map(([key, value]) => [key, Array.isArray(value) ? value.slice(0, 3) : value])) : undefined,
    knownHardConstraints: context.knownHardConstraints.slice(0, 12),
    knownSoftPreferences: context.knownSoftPreferences.slice(0, 6),
    contextTruncated: true,
  });
  const boundedContext = [serialized, compact, core, minimal]
    .find((value) => value.length <= maximumContextTextLength);
  if (!boundedContext) throw new Error("Agent context exceeds the bounded message budget");
  return [
    "次の構造化Contextを使って利用者の目的と制約を解釈し、必要なEvidenceを得る能力を選択してください。",
    "既知条件は聞き直さず、Tool結果は事実として扱い、推測で補完しないでください。",
    "currentTripは計画、travelCandidatesとcurrentJourneyは比較・照会中の検索結果、realtimeFactsは検索時点の観測です。候補の先頭や現在の見込時刻を採用済み計画にしないでください。",
    `<agent_context>${boundedContext}</agent_context>`,
  ].join("\n");
}

function compactCurrentJourney(
  value: Record<string, unknown> | undefined,
  maximumJourneys = 1,
): Record<string, unknown> | undefined {
  if (!value) return undefined;
  return {
    ...(value.contextKind ? { contextKind: value.contextKind } : {}),
    ...(value.originStation ? { originStation: value.originStation } : {}),
    ...(value.destinationStation ? { destinationStation: value.destinationStation } : {}),
    ...(value.departureDate ? { departureDate: value.departureDate } : {}),
    ...(value.serviceDate ? { serviceDate: value.serviceDate } : {}),
    ...(Array.isArray(value.journeys)
      ? { journeys: value.journeys.slice(0, maximumJourneys) }
      : {}),
    ...(Array.isArray(value.pendingAlternatives)
      ? { pendingAlternatives: value.pendingAlternatives.slice(0, 3) }
      : {}),
  };
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
  const messages = [...(value.messages ?? [])];
  const notes: string[] = [];
  for (const note of value.relevantMessages ?? []) {
    try {
      const entries: unknown = JSON.parse(note);
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          if (entry && (entry.role === "user" || entry.role === "assistant") && typeof entry.text === "string") {
            messages.push({ role: entry.role, text: entry.text });
          }
        }
        continue;
      }
    } catch { /* Plain legacy notes do not require JSON. */ }
    notes.push(note);
  }
  return {
    ...(text(value.summary, 800) ? { summary: text(value.summary, 800) } : {}),
    messages: messages.slice(-12).map(({ role, text: content }) => ({ role, text: bounded(content, 1_600) })),
    relevantMessages: texts(notes, 8, 500),
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

function boundedUnknownRecord(
  value: Record<string, unknown>,
  maximumDepth = 4,
): Record<string, unknown> {
  return boundedUnknown(value, 0, maximumDepth) as Record<string, unknown>;
}

function boundedUnknown(value: unknown, depth: number, maximumDepth: number): unknown {
  if (depth >= maximumDepth) return "[depth-limited]";
  if (typeof value === "string") return bounded(value, 300);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => boundedUnknown(item, depth + 1, maximumDepth));
  }
  if (!value || typeof value !== "object") return null;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !/(?:token|secret|password|credential|api[_-]?key|latitude|longitude|coordinates?)/iu.test(key))
    .slice(0, 30)
    .map(([key, item]) => [
      bounded(key, 80),
      boundedUnknown(item, depth + 1, maximumDepth),
    ]));
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

function calendarDateReferences(value: string | undefined): Pick<AgentFeatureContext, "relativeDates"> {
  if (!date(value)) return {};
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) return {};
  const dates = [0, 1, 2].map((days) => new Date(timestamp + days * 86_400_000).toISOString().split("T")[0]!);
  if (!dates.every((item) => date(item))) return {};
  return { relativeDates: { today: dates[0]!, tomorrow: dates[1]!, dayAfterTomorrow: dates[2]! } };
}
