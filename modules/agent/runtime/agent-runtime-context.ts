import type { AgentRuntimeFeature } from "./runtime-contract";
import type { AgentDecisionSummary } from "./agent-decision-summary";
import type { TripRequest } from "@raiquora/trip/trip-request";
import type { InTripContextSnapshot } from "@raiquora/trip/in-trip-context";
import type { AgentTurnOutcome } from "./agent-turn-outcome";
import type { AgentTripScheduleItem } from "./agent-context-snapshot";
import type { AgentReservationContext } from "./reservation-context";
import type { AgentTripFeasibilityContext } from "./trip-feasibility-context";
import type { AgentTripReadinessContext } from "./trip-readiness-context";
import type { InTripPresentation } from "./in-trip-answer-plan";
import type { AgentTaskContext } from "./agent-task-context";
import type { ConversationWorkingState } from "./conversation-working-state";
import type { EffectiveIntent } from "./effective-intent";

/** Application data contract and bounded history projection, without model instructions. */
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
  title?: string;
  scope?: "general" | "trip" | "place" | "route";
  summary?: string;
  messages?: Array<{ role: "user" | "assistant"; text: string }>;
  /** Legacy notes; serialized conversations are decoded before bounding. */
  relevantMessages?: string[];
  resolvedTopics?: string[];
  pendingTopics?: string[];
}

export interface AgentFeatureContext {
  feature: AgentRuntimeFeature;
  /** Ephemeral interaction reference, not a Trip field or planning state. */
  uiFocus?: { itemId: string; item: AgentTripScheduleItem };
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
  knowledgeKind?: import("./evidence-model").EvidenceKnowledgeKind;
  sourceType?: import("./evidence-model").EvidenceSourceType;
  freshness?: import("./evidence-model").EvidenceFreshness;
  coverage?: import("./evidence-model").EvidenceCoverage[];
  presentations?: InTripPresentation[];
}

export interface AgentToolOutcomeSummary {
  toolName: string;
  outcome: "success" | "error";
  summary: string;
}

export interface AgentRuntimeContextInput {
  taskContext?: AgentTaskContext;
  /** Trusted Application projection shared by model, Tool policy and public response. */
  effectiveIntent?: EffectiveIntent;
  workingState?: ConversationWorkingState;
  inTripReplanScope?: ReturnType<typeof import("@raiquora/trip/in-trip-replan").replanScopeContext>;
  inTrip?: InTripContextSnapshot;
  tripReadiness?: AgentTripReadinessContext;
  tripFeasibility?: AgentTripFeasibilityContext;
  reservations?: AgentReservationContext;
  previousAssistantTurn?: AgentTurnOutcome;
  /** Current execution's external decision result, never promoted into Trip.request. */
  currentTurnDecision?: AgentDecisionSummary;
  travelCandidates?: Record<string, unknown>[];
  realtimeFacts?: Record<string, unknown>[];
  featureContext?: Omit<AgentFeatureContext, "feature">;
  conversation?: AgentConversationContext;
  tripContext?: Record<string, AgentContextValue | AgentContextValue[]>;
  travelProfile?: Record<string, unknown>;
  currentTrip?: Record<string, unknown> & { request?: TripRequest };
  consultationRequest?: TripRequest;
  currentJourney?: Record<string, unknown>;
  verifiedFacts?: AgentVerifiedFactSummary[];
  knownHardConstraints?: AgentKnownConstraint[];
  knownSoftPreferences?: AgentKnownPreference[];
  previousToolOutcomes?: AgentToolOutcomeSummary[];
}

export function boundAgentConversationContext(value: AgentConversationContext): AgentConversationContext {
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
    ...(text(value.title, 160) ? { title: text(value.title, 160) } : {}),
    ...(value.scope && ["general", "trip", "place", "route"].includes(value.scope) ? { scope: value.scope } : {}),
    ...(text(value.summary, 800) ? { summary: text(value.summary, 800) } : {}),
    messages: messages.slice(-12).map(({ role, text: content }) => ({ role, text: bounded(content, 1_600) })),
    relevantMessages: texts(notes, 8, 500),
    resolvedTopics: texts(value.resolvedTopics, 12, 120),
    pendingTopics: texts(value.pendingTopics, 12, 120),
  };
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

function date(value: string | undefined): boolean {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value);
}

export function calendarDateReferences(value: string | undefined): Pick<AgentFeatureContext, "relativeDates"> {
  if (!date(value)) return {};
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) return {};
  const dates = [0, 1, 2].map((days) => new Date(timestamp + days * 86_400_000).toISOString().split("T")[0]!);
  if (!dates.every((item) => date(item))) return {};
  return { relativeDates: { today: dates[0]!, tomorrow: dates[1]!, dayAfterTomorrow: dates[2]! } };
}
