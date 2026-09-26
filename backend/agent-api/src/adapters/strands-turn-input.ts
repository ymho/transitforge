import type { ServerAgentRuntimeInput } from "../ports/server-agent-runtime.js";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export class StrandsTurnInputError extends Error {
  constructor(readonly code: "invalid_input" | "unresolved_intent" | "context_budget") {
    super(`Agent v2 input rejected: ${code}`);
    this.name = "StrandsTurnInputError";
  }
}

/** Per-turn data projection only. No planning instructions, prompts or persisted state. */
export function strandsTurnInput(input: ServerAgentRuntimeInput): string {
  if (!input.userRequest.trim() || input.userRequest.length > 8_000) {
    throw new StrandsTurnInputError("invalid_input");
  }
  const context = input.context;
  // The Application, not the engine or a legacy serializer, must resolve priority.
  if (!context?.effectiveIntent && (context?.consultationRequest || context?.currentTrip?.request ||
      context?.workingState?.semantic)) throw new StrandsTurnInputError("unresolved_intent");

  const state = context ? {
    ...(context.currentTrip ? { trip: withoutRequest(context.currentTrip) } : {}),
    ...(context.currentJourney ? { journey: context.currentJourney } : {}),
    ...(context.inTrip ? { inTrip: context.inTrip } : {}),
    ...(context.inTripReplanScope ? { replanScope: context.inTripReplanScope } : {}),
    ...(context.reservations ? { reservations: context.reservations } : {}),
    ...(context.tripFeasibility ? { feasibility: context.tripFeasibility } : {}),
    ...(context.tripReadiness ? { readiness: context.tripReadiness } : {}),
    ...(context.featureContext?.uiFocus ? { viewSelection: context.featureContext.uiFocus } : {}),
  } : {};
  const application = publicData({
    // Clock information is never copied into requested travel conditions.
    clock: {
      role: "reference_only",
      ...(context?.featureContext?.calendarDate ? { referenceDate: context.featureContext.calendarDate } : {}),
      ...(context?.featureContext?.serviceDate ? { serviceDate: context.featureContext.serviceDate } : {}),
    },
    effectiveIntent: context?.effectiveIntent ?? null,
    state,
    conversation: context?.conversation ? {
      title: context.conversation.title,
      summary: context.conversation.summary,
      messages: context.conversation.messages,
      pendingTopics: context.conversation.pendingTopics,
      resolvedTopics: context.conversation.resolvedTopics,
    } : null,
    // These objects are the actual admitted observations, not model interpretations
    // or duplicated summaries from the previous runtime's decision context.
    evidence: input.initialEvidence ?? [],
    // SDK Tool specs are the capability source of truth. Do not duplicate an
    // incomplete registry view here (Application-local writers are added later).
  });
  const serialized = JSON.stringify({ userMessage: input.userRequest, application });
  // Fail explicitly rather than silently dropping dates, exclusions or corrections.
  if (serialized.length > 24_000) throw new StrandsTurnInputError("context_budget");
  return serialized;
}

function withoutRequest(value: Record<string, unknown>): Record<string, unknown> {
  const result = { ...value };
  for (const key of ["request", "effectiveHardConstraints", "effectiveSoftPreferences", "unconfirmedAssumptions"]) {
    delete result[key];
  }
  return result;
}

/** Defense in depth; caller must supply owner-scoped, consent-filtered projections. */
function publicData(value: unknown, parents = new Set<object>(), depth = 0): Json {
  if (depth > 24) throw new StrandsTurnInputError("context_budget");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || parents.has(value)) throw new StrandsTurnInputError("invalid_input");
  parents.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => publicData(item, parents, depth + 1));
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new StrandsTurnInputError("invalid_input");
    }
    const result: { [key: string]: Json } = Object.create(null);
    for (const [key, field] of Object.entries(value)) {
      if (field === undefined || privateField(key)) continue;
      result[key] = publicData(field, parents, depth + 1);
    }
    return result;
  } finally {
    parents.delete(value);
  }
}

function privateField(key: string): boolean {
  return /(?:token|secret|password|credential|api[_-]?key|authorization|cookie|latitude|longitude|coordinates?)/iu.test(key) ||
    /^(?:owner|ownerId|ownerSub|principal|__proto__|constructor|prototype)$/u.test(key);
}
