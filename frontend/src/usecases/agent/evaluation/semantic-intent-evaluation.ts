import type { UtteranceInterpretation } from "@raiquora/agent/semantic-interpretation";

export interface SemanticIntentCaseInput {
  caseId: string;
  category: string;
  utterance: string;
  calendarDate?: string;
  tags: string[];
}

export interface ExpectedSemanticOperation {
  action?: UtteranceInterpretation["operations"][number]["action"];
  target: UtteranceInterpretation["operations"][number]["target"];
  modality?: UtteranceInterpretation["operations"][number]["modality"];
  precision?: UtteranceInterpretation["operations"][number]["precision"];
  frame?: "actual" | "hypothetical";
  scope?: NonNullable<UtteranceInterpretation["operations"][number]["scope"]>;
  value?: Record<string, unknown>;
}

export interface SemanticIntentCaseExpected {
  caseId: string;
  allowed: Array<{
    outcome: UtteranceInterpretation["outcome"];
    speechAct?: UtteranceInterpretation["speechAct"];
    operations: ExpectedSemanticOperation[];
  }>;
  forbiddenTargets: UtteranceInterpretation["operations"][number]["target"][];
}

export interface SemanticIntentCaseScore {
  caseId: string;
  passed: boolean;
  matchedAllowedIndex?: number;
  failures: string[];
}

/** Exact semantic scorer. It deliberately receives expected data only after the
 * model call, so a runner cannot place gold operations in model context. */
export function scoreSemanticInterpretation(expected: SemanticIntentCaseExpected,
  actual: UtteranceInterpretation): SemanticIntentCaseScore {
  const forbidden = actual.operations.filter(({ target }) => expected.forbiddenTargets.includes(target));
  const matchedAllowedIndex = expected.allowed.findIndex((candidate) => matches(candidate, actual));
  const failures = [
    ...(forbidden.length ? [`forbidden-target:${[...new Set(forbidden.map(({ target }) => target))].join(",")}`] : []),
    ...(matchedAllowedIndex < 0 ? ["no-allowed-interpretation-matched"] : []),
  ];
  return { caseId: expected.caseId, passed: failures.length === 0,
    ...(matchedAllowedIndex >= 0 ? { matchedAllowedIndex } : {}), failures };
}

function matches(expected: SemanticIntentCaseExpected["allowed"][number], actual: UtteranceInterpretation): boolean {
  if (expected.outcome !== actual.outcome || expected.speechAct !== undefined && expected.speechAct !== actual.speechAct ||
      expected.operations.length !== actual.operations.length) return false;
  return expected.operations.every((operation, index) => operationMatches(operation, actual.operations[index]!));
}

function operationMatches(expected: ExpectedSemanticOperation, actual: UtteranceInterpretation["operations"][number]): boolean {
  return expected.target === actual.target &&
    (expected.action === undefined || expected.action === actual.action) &&
    (expected.modality === undefined || expected.modality === actual.modality) &&
    (expected.precision === undefined || expected.precision === actual.precision) &&
    (expected.frame === undefined || expected.frame === actual.frame) &&
    (expected.scope === undefined || canonical(expected.scope) === canonical(actual.scope)) &&
    (expected.value === undefined || canonical(expected.value) === canonical(actual.value));
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
