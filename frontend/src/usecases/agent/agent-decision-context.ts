import type { AgentToolDescriptor } from "./tool-contract";
import type { AgentRuntimeFeature, AgentRuntimeRequest } from "./runtime-contract";
import { parseAgentDecisionSummary, type AgentDecisionSummary } from "./agent-decision-summary";
import { effectiveTripConstraints, type TripRequest } from "@raiquora/trip/trip-request";
import type { AgentTurnOutcome } from "./agent-turn-outcome";
import { candidateAssessmentContext } from "./candidate-assessment-context";
import type { AgentTripScheduleItem } from "./agent-context-snapshot";
import { reservationContext, type AgentReservationContext } from "./reservation-context";
import { tripFeasibilityContext, type AgentTripFeasibilityContext } from "./trip-feasibility-context";

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
}

export interface AgentToolOutcomeSummary {
  toolName: string;
  outcome: "success" | "error";
  summary: string;
}

export interface AgentRuntimeContextInput {
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
  tripFeasibility?: AgentTripFeasibilityContext;
  reservations?: AgentReservationContext;
  previousAssistantTurn?: AgentTurnOutcome;
  persistedTripRequest?: unknown;
  tripHardConstraints?: unknown;
  tripSoftPreferences?: unknown;
  unconfirmedAssumptions?: unknown;
  currentTurnDecision?: AgentDecisionSummary;
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
  const tripRequest = input?.currentTrip?.request;
  const hasTripRequest = tripRequest !== undefined;
  const effective = tripRequest ? effectiveTripConstraints(tripRequest) : [];
  const currentTrip = input?.currentTrip ? Object.fromEntries(Object.entries(input.currentTrip).filter(([key]) =>
    !["request", "effectiveHardConstraints", "effectiveSoftPreferences", "unconfirmedAssumptions"].includes(key))) : undefined;
  const projectedTrip = currentTrip ? boundedUnknownRecord(currentTrip, 6) : undefined;
  if (projectedTrip && Array.isArray(currentTrip?.schedule) && Array.isArray(projectedTrip.schedule)) {
    projectedTrip.scheduleTruncated = currentTrip.scheduleTruncated === true || currentTrip.schedule.length > projectedTrip.schedule.length;
  }
  if (projectedTrip && currentTrip?.itineraryPlaces) Object.assign(projectedTrip, compactTripPlaces(currentTrip, 20));
  const decision = parseAgentDecisionSummary(input?.currentTurnDecision);
  const reservations = input?.reservations
    ? reservationContext(input.reservations.status === "available" ? input.reservations.facts : undefined)
    : undefined;
  return {
    ...(input?.tripFeasibility ? { tripFeasibility: { ...tripFeasibilityContext(input.tripFeasibility),
      truncated: input.tripFeasibility.truncated, totalIssueCount: input.tripFeasibility.totalIssueCount } } : {}),
    ...(reservations ? { reservations: { ...reservations,
      truncated: reservations.truncated || input?.reservations?.truncated === true } } : {}),
    ...(input?.previousAssistantTurn ? { previousAssistantTurn: input.previousAssistantTurn } : {}),
    ...(hasTripRequest ? {
      // Preserve complete typed constraints/links, not the generic key/value legacy interpretation.
      // Privacy is still enforced; an oversized request fails the message budget rather than losing conditions.
      persistedTripRequest: privateRequestProjection(tripRequest),
      tripHardConstraints: privateRequestProjection(effective.filter((c) => c.strength === "hard")),
      tripSoftPreferences: privateRequestProjection(effective.filter((c) => c.strength === "soft")),
      unconfirmedAssumptions: privateRequestProjection(tripRequest!.assumptions.filter((a) => a.status === "unconfirmed")),
    } : {}),
    ...(decision ? { currentTurnDecision: structuredClone(decision) } : {}),
    userRequest: bounded(request.userRequest, 1_500),
    ...(input?.travelCandidates ? { travelCandidates: input.travelCandidates.slice(0, 12).map((value) =>
      value.assessment && value.candidate ? candidateAssessmentContext(value as Parameters<typeof candidateAssessmentContext>[0]) : boundedUnknownRecord(value)) } : {}),
    ...(input?.realtimeFacts ? { realtimeFacts: input.realtimeFacts.slice(0, 12).map((value) => boundedUnknownRecord(value)) } : {}),
    featureContext: {
      feature: request.feature,
      ...(input?.featureContext?.uiFocus && hasTripRequest &&
        input.featureContext.uiFocus.itemId === input.featureContext.uiFocus.item.itemId
        ? { uiFocus: privateRequestProjection(input.featureContext.uiFocus) as AgentFeatureContext["uiFocus"] } : {}),
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
    ...(!hasTripRequest && input?.tripContext ? { tripContext: boundedRecord(input.tripContext, 20) } : {}),
    ...(input?.travelProfile ? { travelProfile: boundedUnknownRecord(input.travelProfile) } : {}),
    // Trip -> schedule[] -> item.schedule -> ZonedInstant -> at/timeZone needs six levels.
    ...(projectedTrip ? { currentTrip: projectedTrip } : {}),
    ...(input?.currentJourney
      ? { currentJourney: boundedUnknownRecord(input.currentJourney, 6) }
      : {}),
    verifiedFacts: (input?.verifiedFacts ?? []).slice(0, 20).map((fact) => ({
      evidenceId: bounded(fact.evidenceId, 160),
      category: bounded(fact.category, 80),
      subject: bounded(fact.subject, 160),
      summary: bounded(fact.summary, 300),
    })),
    knownHardConstraints: (input?.knownHardConstraints ?? []).filter((c) => !hasTripRequest || ["user", "ui"].includes(c.source)).slice(0, 20)
      .map(constraint),
    knownSoftPreferences: (input?.knownSoftPreferences ?? []).filter((c) => !hasTripRequest || c.source === "user").slice(0, 20)
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
  const requestFields = {
    previousAssistantTurn: context.previousAssistantTurn,
    persistedTripRequest: context.persistedTripRequest,
    tripHardConstraints: context.tripHardConstraints,
    tripSoftPreferences: context.tripSoftPreferences,
    unconfirmedAssumptions: context.unconfirmedAssumptions,
    currentTurnDecision: context.currentTurnDecision,
  };
  const serialized = JSON.stringify({
    ...context,
    availableTools: context.availableTools.map(({ name, requiredInputs }) => ({
      name,
      requiredInputs,
    })),
  });
  const compact = JSON.stringify({
      ...requestFields,
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
      reservations: context.reservations,
      tripFeasibility: context.tripFeasibility,
      travelCandidates: context.travelCandidates?.slice(0, 4),
      realtimeFacts: context.realtimeFacts?.slice(0, 4),
      currentJourney: compactCurrentJourney(context.currentJourney, 2),
      knownHardConstraints: context.knownHardConstraints,
      knownSoftPreferences: context.knownSoftPreferences,
      availableTools: context.availableTools.map(({ name }) => name),
      contextTruncated: true,
    });
  const core = JSON.stringify({
    ...requestFields,
    userRequest: context.userRequest.slice(0, 1_000),
    featureContext: context.featureContext,
    conversation: context.conversation ? {
      ...context.conversation,
      messages: context.conversation.messages?.slice(-4),
    } : undefined,
    tripContext: context.tripContext,
    travelProfile: context.travelProfile,
    currentTrip: compactCurrentTrip(context.currentTrip, 4),
    reservations: context.reservations,
    tripFeasibility: context.tripFeasibility,
    travelCandidates: context.travelCandidates?.slice(0, 2),
    realtimeFacts: context.realtimeFacts?.slice(0, 2),
    currentJourney: compactCurrentJourney(context.currentJourney),
    knownHardConstraints: context.knownHardConstraints.slice(0, 12),
    knownSoftPreferences: context.knownSoftPreferences.slice(0, 12),
    availableTools: context.availableTools.slice(0, 16).map(({ name }) => name),
    contextTruncated: true,
  });
  const minimal = JSON.stringify({
    ...requestFields,
    userRequest: context.userRequest,
    featureContext: context.featureContext,
    conversation: context.conversation ? {
      summary: context.conversation.summary,
      messages: context.conversation.messages?.slice(-4).map(({ role, text }) => ({ role, text: text.slice(0, 800) })),
      pendingTopics: context.conversation.pendingTopics,
    } : undefined,
    tripContext: context.tripContext ? Object.fromEntries(Object.entries(context.tripContext).slice(0, 20)
      .map(([key, value]) => [key, Array.isArray(value) ? value.slice(0, 3) : value])) : undefined,
    ...(context.persistedTripRequest !== undefined ? { travelProfile: context.travelProfile } : {}),
    currentTrip: compactCurrentTrip(context.currentTrip, 4),
    reservations: context.reservations,
    tripFeasibility: context.tripFeasibility,
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
    "persistedTripRequest.partyは今回の同行者です。party.assumptionIdに対応するunconfirmedAssumptionsは仮置きで、travelProfile.companionsは普段の傾向です。混ぜず、今回の明示partyを優先し、既知人数を聞き直さないでください。子どものage/ageGroup不明でも候補や仮旅程を提案できます。具体的なProvider操作がexact ageを要求した時だけ年齢を確認し、可能なProgressも併記してください。Profileの区分から人数や年齢を捏造しないでください。",
    "previousAssistantTurnは一時的な回答観測でTripのstateではありません。質問が必要でも可能なら同じturnで具体候補・比較・Proposalを示してください。連続ask_onlyは原則不可ですが、安全・未確認hard条件・本当に不足するTool必須入力は構造化例外として扱えます。内部Tool実行だけを進展と呼ばず、候補選択後は検証済みsnapshotからProposalを作り、時刻不明はunscheduled/day/windowのまま扱えます。",
    "過去Tripの振り返りと新しい旅行相談を区別し、保存Requestの年や条件を新しい旅行の希望へ無言で流用しないでください。未確認hard条件の成立を仮定せず、可能な進展と要確認事項を分けてください。",
    "期待成果物の目安は、inspiration/candidate_discoveryなら方向性・候補、candidate_selectionなら比較材料、itinerary_draft/itinerary_refinementなら具体的な変更案です。readyでは不要な確認を増やさず、in_tripでは既存Tripを前提にしてください。これはToolの固定割当や状態遷移の強制ではありません。",
    "currentTripは計画、travelCandidatesとcurrentJourneyは比較・照会中の検索結果、realtimeFactsは検索時点の観測です。候補の先頭や現在の見込時刻を採用済み計画にしないでください。",
    "reservationsはTripの採用状態とは別の予約記録です。bookedの予定の削除・置換には影響を説明して明示確認を求めてください。変更案は予約取消・変更の実行ではありません。予約がunknown・truncatedなら未掲載の予約がないと断定せず、selectedやbooking URLから予約済み・未予約を推測しないでください。",
    "tripFeasibilityは採用済みTripをコードで検証した派生結果です。infeasibleの違反を説明だけで消さず、unknownを成立・問題なしと断定しないでください。readyは全事実の確認済みを意味せず、宿泊の正確な時刻等の未確認は残る場合があります。issueの対象を説明し変更案を提案できますが、自動修正・readyの自己認定はできません。評価revisionと現在Tripを区別し、truncatedは未掲載の問題がないという意味ではありません。",
    "featureContext.uiFocusは利用者が画面で選択した予定の一時的な参照です。「ここ」などの相談では同じitemIdの最新itemを参照し、変更は具体的なProposalにしてください。focus自体はTripの状態でも変更の承認でもなく、他の予定を変更する指示ではありません。",
    "currentTrip.planningState/lifecycleStateはTripの現在地であり、Tool選択や質問順を固定しません。persistedTripRequestは希望・条件、currentTurnDecisionは今回の判断で、状態とは別です。pre_tripだけで将来の旅行とは断定せず、採用済みscheduleの年・精度を保ち、過去日程を今年や翌年に補正しないでください。旅行日・実行状態をViewerの表示日時から推測せず、scheduleTruncatedの場合は全旅行期間を断定しないでください。状態変更はProposalにしてください。",
    ...(context.persistedTripRequest !== undefined ? ["persistedTripRequestだけが今回条件の正本です。tripHardConstraints/ tripSoftPreferencesは有効条件の読み取り投影で、強さと仮定の確認状態は別です。unconfirmedAssumptionsは仮置きとして説明し、却下済みの条件は使わないでください。travelProfileは普段の嗜好、currentTurnDecisionは今回の解釈です。解釈や履歴で正本を上書きせず、変更はProposalとして提案してください。"] : []),
    `<agent_context>${boundedContext}</agent_context>`,
  ].join("\n");
}

/** Read-only projection of a validated V2 request. IDs/ranges/affects must survive compaction. */
function privateRequestProjection(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(privateRequestProjection);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) =>
    !/(?:token|secret|password|credential|api[_-]?key|latitude|longitude|coordinates?)/iu.test(key))
    .map(([key, field]) => [key, privateRequestProjection(field)]));
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
    ...(value.planningState ? { planningState: value.planningState } : {}),
    ...(value.lifecycleState ? { lifecycleState: value.lifecycleState } : {}),
    ...(value.temporalAssessment ? { temporalAssessment: value.temporalAssessment } : {}),
    ...(value.hardConstraintEvaluation ? { hardConstraintEvaluation: value.hardConstraintEvaluation } : {}),
    ...(value.destination ? { destination: value.destination } : {}),
    ...(value.summaryDestination ? { summaryDestination: value.summaryDestination } : {}),
    ...compactTripPlaces(value, maximumScheduleItems),
    ...(value.adults !== undefined ? { adults: value.adults } : {}),
    ...(value.children !== undefined ? { children: value.children } : {}),
    ...(Array.isArray(value.considerations)
      ? { considerations: value.considerations.slice(0, 6) }
      : {}),
    ...(Array.isArray(value.schedule)
      ? { schedule: value.schedule.slice(0, maximumScheduleItems), scheduleTruncated: value.schedule.length > maximumScheduleItems || value.scheduleTruncated === true }
      : {}),
  };
}

/** Keep occurrence order and opaque identities; a shortened list never becomes a destination. */
function compactTripPlaces(value: Record<string, unknown>, limit: number): Record<string, unknown> {
  if (!value.itineraryPlaces || typeof value.itineraryPlaces !== "object") return {};
  let truncated = value.placesTruncated === true;
  const lists = Object.fromEntries(["visitedPlaces", "overnightPlaces", "transportEndpoints"].map((key) => {
    const entries = (value.itineraryPlaces as Record<string, unknown>)[key];
    if (!Array.isArray(entries)) { truncated = true; return [key, []]; }
    if (entries.length > limit) truncated = true;
    // This is the already bounded, typed snapshot projection. As for persistedTripRequest,
    // preserve identifiers rather than normalizing them into another valid-looking identity.
    return [key, privateRequestProjection(entries.slice(0, limit))];
  }));
  return { itineraryPlaces: lists, placesTruncated: truncated,
    ...(value.placeSemantics ? { placeSemantics: value.placeSemantics } : {}) };
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
