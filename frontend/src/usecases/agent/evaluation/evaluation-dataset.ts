import {
  agentEvaluationDatasetSchemaVersion,
  agentEvaluationObservationSchemaVersion,
  type AgentEvaluationCase,
  type AgentEvaluationDataset,
  type AgentEvaluationExpectation,
  type AgentEvaluationObservation,
  type AgentEvaluationObservationSet,
  type ConversationQualityScenario,
} from "./evaluation-contract";
import type { TravelProgressScenario } from "./travel-progress-evaluation";

const knownFeatures = new Set([
  "concierge",
  "journey_planning",
  "train_guidance",
  "operational_analysis",
  "travel_planning",
]);
const knownStatuses = new Set(["completed", "follow_up", "limit_reached", "failed"]);

export function parseAgentEvaluationDataset(value: unknown): AgentEvaluationDataset {
  if (!isRecord(value) || !hasOnlyKeys(value, ["schemaVersion", "cases", "travelProgressScenarios", "conversationQualityScenarios"]) ||
    value.schemaVersion !== agentEvaluationDatasetSchemaVersion) {
    throw new Error("Agent Eval datasetのschemaVersionが不正です");
  }
  if (!Array.isArray(value.cases) || value.cases.length === 0 || value.cases.length > 100) {
    throw new Error("Agent Eval datasetは1件から100件で指定してください");
  }
  const cases = value.cases.map(parseCase);
  ensureUnique(cases.map(({ id }) => id), "Agent Eval case ID");
  const travelProgressScenarios = value.travelProgressScenarios === undefined ? undefined : parseTravelProgressScenarios(value.travelProgressScenarios);
  const conversationQualityScenarios = value.conversationQualityScenarios === undefined ? undefined : parseConversationQualityScenarios(value.conversationQualityScenarios);
  ensureUnique([...cases.map(({ id }) => id), ...(travelProgressScenarios ?? []).map(({ id }) => id),
    ...(conversationQualityScenarios ?? []).map(({ id }) => id)], "Agent Eval case ID");
  return { schemaVersion: value.schemaVersion, cases, ...(travelProgressScenarios ? { travelProgressScenarios } : {}),
    ...(conversationQualityScenarios ? { conversationQualityScenarios } : {}) };
}

function parseConversationQualityScenarios(value: unknown): ConversationQualityScenario[] {
  if (!Array.isArray(value) || !value.length || value.length > 50) throw new Error("Conversation Quality scenarios must contain 1..50 cases");
  return value.map((scenario) => {
    if (!isRecord(scenario) || !hasOnlyKeys(scenario, ["id", "name", "tags", "input", "expected"]) ||
        !identifier(scenario.id) || !text(scenario.name, 160) || !isRecord(scenario.input) ||
        !hasOnlyKeys(scenario.input, ["conversationId", "fixedNow", "turns", "providerFixture"]) || !uuid(scenario.input.conversationId) || !instant(scenario.input.fixedNow) ||
        !Array.isArray(scenario.input.turns) || scenario.input.turns.length < 1 || scenario.input.turns.length > 12 ||
        scenario.input.turns.some((turn) => !isRecord(turn) || !hasOnlyKeys(turn, ["role", "text"]) || turn.role !== "user" || !text(turn.text, 2_000)) ||
        scenario.input.providerFixture !== "izumo" && scenario.input.providerFixture !== "west_japan_discovery" ||
        !stringList(scenario.tags, 12) || !isRecord(scenario.expected)) throw new Error("Invalid Conversation Quality scenario");
    const expected = scenario.expected;
    if (!hasOnlyKeys(expected, ["destination", "relativeDates", "forbiddenRepeatedQuestions", "assumptions", "requiredFinalCapabilities", "maximumTurnsToStarterPlan", "minimumPlacePhotos", "maximumAskOnlyStreak", "maximumQuestionsPerAssistantTurn", "forbiddenProfilePromotions"]) ||
        !validQualityDestination(expected.destination) ||
        !Array.isArray(expected.relativeDates) || expected.relativeDates.length > 10 || expected.relativeDates.some((date) =>
          !isRecord(date) || !hasOnlyKeys(date, ["sourceText", "calendarDate"]) || !text(date.sourceText, 160) || !calendarDate(date.calendarDate)) ||
        !stringList(expected.forbiddenRepeatedQuestions, 20) || !isRecord(expected.assumptions) ||
        !hasOnlyKeys(expected.assumptions, ["allowed", "mustBeExplicit", "mustRemainUnconfirmed"]) || !stringList(expected.assumptions.allowed, 20) ||
        typeof expected.assumptions.mustBeExplicit !== "boolean" || typeof expected.assumptions.mustRemainUnconfirmed !== "boolean" ||
        !stringList(expected.requiredFinalCapabilities, 20) || !positiveInteger(expected.maximumTurnsToStarterPlan, 12) ||
        !positiveInteger(expected.minimumPlacePhotos, 8) || !nonNegativeInteger(expected.maximumAskOnlyStreak, 12) ||
        !nonNegativeInteger(expected.maximumQuestionsPerAssistantTurn, 10) || !stringList(expected.forbiddenProfilePromotions, 20)) {
      throw new Error("Invalid Conversation Quality expectation");
    }
    return structuredClone(scenario) as unknown as ConversationQualityScenario;
  });
}

function validQualityDestination(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.mode === "specified") return hasOnlyKeys(value, ["mode", "name", "municipality", "optionalExpansionMunicipalities"]) &&
    text(value.name, 160) && text(value.municipality, 160) && stringList(value.optionalExpansionMunicipalities, 10);
  if (value.mode === "discovery") return hasOnlyKeys(value, ["mode", "minimumCandidates", "maximumCandidates", "recommendationScope", "forbiddenMainCandidates"]) &&
    positiveInteger(value.minimumCandidates, 5) && positiveInteger(value.maximumCandidates, 5) &&
    Number(value.maximumCandidates) >= Number(value.minimumCandidates) && text(value.recommendationScope, 160) &&
    stringList(value.forbiddenMainCandidates, 20);
  return false;
}

function parseTravelProgressScenarios(value: unknown): TravelProgressScenario[] {
  if (!Array.isArray(value) || !value.length || value.length > 50) throw new Error("Trip Progress scenarios must contain 1..50 cases");
  return value.map((s) => {
    if (!isRecord(s) || !hasOnlyKeys(s, ["id", "name", "userRequest", "tags", "thresholds"]) ||
        !identifier(s.id) || !text(s.name, 160) || !text(s.userRequest, 1000) || !stringList(s.tags, 12) ||
        !isRecord(s.thresholds) || !hasOnlyKeys(s.thresholds, ["ttfc", "ttfi", "selectionToDraft", "maximumOrdinaryAskOnlyStreak"])) throw new Error("Invalid Trip Progress scenario");
    const t = s.thresholds;
    const limit = (n: unknown) => typeof n === "number" && Number.isSafeInteger(n) && n >= 1 && n <= 20;
    if (!limit(t.selectionToDraft) || typeof t.maximumOrdinaryAskOnlyStreak !== "number" ||
        !Number.isSafeInteger(t.maximumOrdinaryAskOnlyStreak) || t.maximumOrdinaryAskOnlyStreak < 0 || t.maximumOrdinaryAskOnlyStreak > 20 ||
        (t.ttfc !== undefined && !limit(t.ttfc)) || (t.ttfi !== undefined && !limit(t.ttfi))) throw new Error("Invalid Trip Progress thresholds");
    return { id: s.id, name: s.name, userRequest: s.userRequest, tags: [...s.tags], thresholds: {
      selectionToDraft: t.selectionToDraft as number, maximumOrdinaryAskOnlyStreak: t.maximumOrdinaryAskOnlyStreak,
      ...(t.ttfc === undefined ? {} : { ttfc: t.ttfc as number }), ...(t.ttfi === undefined ? {} : { ttfi: t.ttfi as number }),
    } };
  });
}

export function parseAgentEvaluationObservations(
  value: unknown,
): AgentEvaluationObservationSet {
  if (!isRecord(value) || !hasOnlyKeys(value, ["schemaVersion", "observations"]) ||
    value.schemaVersion !== agentEvaluationObservationSchemaVersion) {
    throw new Error("Agent Eval observationのschemaVersionが不正です");
  }
  if (!Array.isArray(value.observations) || value.observations.length > 100) {
    throw new Error("Agent Eval observationは100件以下にしてください");
  }
  const observations = value.observations.map(parseObservation);
  ensureUnique(observations.map(({ caseId }) => caseId), "Agent Eval observation case ID");
  return { schemaVersion: agentEvaluationObservationSchemaVersion, observations };
}

function parseCase(value: unknown, index: number): AgentEvaluationCase {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "id", "name", "feature", "userRequest", "journeyScenarioId", "tags", "expected",
  ]) || !identifier(value.id) || !text(value.name, 160) ||
    !knownFeatures.has(String(value.feature)) || !text(value.userRequest, 1_000) ||
    !stringList(value.tags, 12) || !isRecord(value.expected)) {
    throw new Error(`Agent Eval case ${index + 1}件目が不正です`);
  }
  const expected = parseExpectation(value.expected, index);
  if (value.journeyScenarioId !== undefined && !identifier(value.journeyScenarioId)) {
    throw new Error(`Agent Eval case ${index + 1}件目のjourneyScenarioIdが不正です`);
  }
  return {
    id: value.id,
    name: value.name,
    feature: value.feature as AgentEvaluationCase["feature"],
    userRequest: value.userRequest,
    ...(value.journeyScenarioId ? { journeyScenarioId: value.journeyScenarioId } : {}),
    tags: [...value.tags],
    expected,
  };
}

function parseExpectation(value: Record<string, unknown>, index: number): AgentEvaluationExpectation {
  if (!hasOnlyKeys(value, [
    "toolSequence", "constraints", "status", "minimumGroundedClaimRate",
    "maximumUnsupportedClaimRate",
    "decision", "alternativeToolSequences",
  ]) || !stringList(value.toolSequence, 8) || !isConstraintRecord(value.constraints) ||
    !knownStatuses.has(String(value.status)) ||
    !rate(value.minimumGroundedClaimRate) || !rate(value.maximumUnsupportedClaimRate) ||
    value.alternativeToolSequences !== undefined && !validAlternativeSequences(value.alternativeToolSequences) ||
    value.decision !== undefined && !validDecisionExpectation(value.decision)) {
    throw new Error(`Agent Eval case ${index + 1}件目の期待値が不正です`);
  }
  return {
    toolSequence: [...value.toolSequence],
    ...(value.alternativeToolSequences === undefined ? {} : {
      alternativeToolSequences: value.alternativeToolSequences.map((sequence) => [...sequence]),
    }),
    constraints: structuredClone(value.constraints),
    status: value.status as AgentEvaluationExpectation["status"],
    minimumGroundedClaimRate: value.minimumGroundedClaimRate,
    maximumUnsupportedClaimRate: value.maximumUnsupportedClaimRate,
    ...(value.decision === undefined ? {} : {
      decision: {
        requiredHardConstraintKeys: [...value.decision.requiredHardConstraintKeys],
        forbiddenUnresolvedFacts: [...value.decision.forbiddenUnresolvedFacts],
      },
    }),
  };
}

function parseObservation(value: unknown, index: number): AgentEvaluationObservation {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "caseId", "toolSequence", "normalizedConstraints", "status", "claimStatuses",
    "decisionHardConstraintKeys", "decisionUnresolvedFacts",
  ]) || !identifier(value.caseId) || !stringList(value.toolSequence, 8) ||
    !isRecord(value.normalizedConstraints) || !knownStatuses.has(String(value.status)) ||
    !Array.isArray(value.claimStatuses) || value.claimStatuses.length > 20 ||
    value.claimStatuses.some((status) =>
      status !== "supported" && status !== "unsupported" && status !== "unknown") ||
    value.decisionHardConstraintKeys !== undefined &&
      !stringList(value.decisionHardConstraintKeys, 20) ||
    value.decisionUnresolvedFacts !== undefined &&
      !stringList(value.decisionUnresolvedFacts, 20)) {
    throw new Error(`Agent Eval observation ${index + 1}件目が不正です`);
  }
  return {
    caseId: value.caseId,
    toolSequence: [...value.toolSequence],
    normalizedConstraints: structuredClone(value.normalizedConstraints),
    status: value.status as AgentEvaluationObservation["status"],
    claimStatuses: [...value.claimStatuses],
    ...(value.decisionHardConstraintKeys === undefined
      ? {}
      : { decisionHardConstraintKeys: [...value.decisionHardConstraintKeys] }),
    ...(value.decisionUnresolvedFacts === undefined
      ? {}
      : { decisionUnresolvedFacts: [...value.decisionUnresolvedFacts] }),
  };
}

function validAlternativeSequences(value: unknown): value is string[][] {
  return Array.isArray(value) && value.length <= 4 &&
    value.every((sequence) => stringList(sequence, 8));
}

function validDecisionExpectation(
  value: unknown,
): value is NonNullable<AgentEvaluationExpectation["decision"]> {
  return isRecord(value) && hasOnlyKeys(value, [
    "requiredHardConstraintKeys", "forbiddenUnresolvedFacts",
  ]) && stringList(value.requiredHardConstraintKeys, 20) &&
    stringList(value.forbiddenUnresolvedFacts, 20);
}

function isConstraintRecord(value: unknown): value is Record<string, string | number | boolean | string[]> {
  return isRecord(value) && Object.values(value).every((item) =>
    typeof item === "string" ||
    (typeof item === "number" && Number.isFinite(item)) || typeof item === "boolean" ||
    stringList(item, 10));
}

function stringList(value: unknown, maximum: number): value is string[] {
  return Array.isArray(value) && value.length <= maximum && value.every(identifier);
}

function identifier(value: unknown): value is string {
  return text(value, 200) && value.trim() === value;
}

function instant(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) && !Number.isNaN(Date.parse(value));
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
}

function calendarDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function nonNegativeInteger(value: unknown, maximum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum;
}

function positiveInteger(value: unknown, maximum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= maximum;
}

function text(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function rate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function ensureUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${label}が重複しています`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}
