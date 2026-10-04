import type { MessageData } from "@strands-agents/sdk";
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
    presentedCandidates: input.candidateController?.context ?? null,
    // SDK Tool specs are the capability source of truth. Do not duplicate an
    // incomplete registry view here (Application-local writers are added later).
  }) as { [key: string]: Json };
  const serialize = () => JSON.stringify({ userMessage: input.userRequest, application });
  let serialized = serialize();
  // Stored source excerpts and old dialogue can outgrow a valid current Trip.
  // Bound only this transport copy. Current conditions, Trip, focus, candidate
  // identities and the two most recent messages remain intact. Applications keep
  // the complete admitted Evidence and persisted history for read-back/grounding.
  const evidence = application.evidence as Json[];
  const conversation = application.conversation as { [key: string]: Json } | null;
  const history = Array.isArray(conversation?.messages) ? conversation.messages : [];
  let omittedEvidence = 0, omittedHistoryMessages = 0;
  const coverage = () => {
    application.contextCoverage = { reason: "transport_budget", omittedEvidence, omittedHistoryMessages };
    serialized = serialize();
  };
  while (serialized.length > 24_000 && evidence.length) {
    evidence.shift(); omittedEvidence++; coverage();
  }
  while (serialized.length > 24_000 && history.length > 2) {
    history.shift(); omittedHistoryMessages++; coverage();
  }
  // Never cut a condition, current utterance, candidate identity or current Trip.
  if (serialized.length > 24_000) throw new StrandsTurnInputError("context_budget");
  return serialized;
}


/** Preserve the Conversation's public user/assistant roles with the SDK's native
 * history input. The same sanitized projection enforces the combined 24k budget;
 * messages are removed from application data rather than duplicated in the prompt.
 * This is data transport, not semantic interpretation or another state store. */
export function strandsConversationInput(input: ServerAgentRuntimeInput): { modelInput: string; applicationReference: string; history: MessageData[] } {
  const payload = JSON.parse(strandsTurnInput(input)) as {
    userMessage: string; application: { conversation: { messages?: unknown } | null };
  };
  const conversation = payload.application.conversation;
  const saved = conversation?.messages ?? [];
  if (!Array.isArray(saved)) throw new StrandsTurnInputError("invalid_input");
  const history: MessageData[] = saved.map((message: unknown) => {
    if (!message || typeof message !== "object" || !("role" in message) || !("text" in message) ||
        (message.role !== "user" && message.role !== "assistant") || typeof message.text !== "string" || !message.text.trim()) {
      throw new StrandsTurnInputError("invalid_input");
    }
    return { role: message.role, content: [{ text: message.text }] };
  });
  if (conversation) delete conversation.messages;
  // Reference state is system-context data. The native user-role message contains
  // only the traveller's current utterance, never quotes from accepted conditions.
  // Escape delimiter characters in JSON values so they cannot close this data block.
  const reference = JSON.stringify({ application: payload.application }).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e");
  const applicationReference = `<application_reference>\n${reference}\n</application_reference>`;
  if (applicationReference.length + payload.userMessage.length > 24_000) throw new StrandsTurnInputError("context_budget");
  return { modelInput: payload.userMessage, applicationReference, history };
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
