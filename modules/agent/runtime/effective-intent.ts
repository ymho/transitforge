import type { ConversationIntentFact, ConversationIntentOverlay, ConversationIntentTombstone, IntentTarget } from "@raiquora/trip/conversation-intent";
import type { TripConstraint, TripRequest } from "@raiquora/trip/trip-request";
import type { TripParty } from "@raiquora/trip/trip-party";

export interface EffectiveIntentBaseFact {
  ref: string;
  target: IntentTarget;
  authority: "persisted_user" | "legacy" | "assumption";
  strength: "hard" | "soft";
  scope: TripConstraint["scope"];
  requirement: TripConstraint["requirement"];
}

export interface EffectiveIntentProfileHint {
  ref: string;
  target: IntentTarget;
  strength: "soft";
  scope: TripConstraint["scope"];
  requirement: TripConstraint["requirement"];
}

export interface EffectiveIntent {
  version: 1;
  base: {
    source: "trip" | "conversation_draft" | "none";
    revision?: number;
    fingerprint: string;
  };
  intentRevision: number;
  activeBaseGoal?: { ref: "request:goal"; value: string; authority: "persisted_user" };
  activeBaseParty?: { ref: "request:party"; value: TripParty; authority: "persisted_user" | "legacy" | "assumption" };
  profilePartyHint?: { ref: "request:party"; value: TripParty; authority: "profile_hint" };
  /** Persisted conditions not shadowed by an explicit current conversation operation. */
  activeBaseFacts: EffectiveIntentBaseFact[];
  /** Profile values remain hints and never acquire user-turn authority. */
  profileHints: EffectiveIntentProfileHint[];
  actualConversationFacts: ConversationIntentFact[];
  hypotheticalFacts: ConversationIntentFact[];
  retractions: ConversationIntentTombstone[];
  suppressedBaseRefs: string[];
  fingerprint: string;
}

/** Pure compiler shared by model/Tool/UI projections. It never mutates the base Request
 * and never upgrades Profile/model/legacy authority to a current user statement. */
export function compileEffectiveIntent(input: {
  baseRequest?: TripRequest;
  baseSource?: "trip" | "conversation_draft";
  baseRevision?: number;
  overlay: ConversationIntentOverlay;
}): EffectiveIntent {
  const constraints = input.baseRequest?.constraints ?? [];
  const actualConversationFacts = input.overlay.facts.filter(({ frame }) => frame === "actual").map(clone);
  const hypotheticalFacts = input.overlay.facts.filter(({ frame }) => frame === "hypothetical").map(clone);
  const actualRetractions = input.overlay.tombstones.filter(({ frame }) => frame === "actual");
  const changedTargets = new Set<IntentTarget>([
    ...actualConversationFacts.map(({ target }) => target),
    ...actualRetractions.map(({ target }) => target),
  ]);
  const suppressedBaseRefs = constraints.filter((constraint) => changedTargets.has(targetForConstraint(constraint)))
    .map(({ id }) => `constraint:${id}`);
  if (input.baseRequest?.goal && changedTargets.has("goal")) suppressedBaseRefs.push("request:goal");
  if (input.baseRequest?.party && changedTargets.has("party_size")) suppressedBaseRefs.push("request:party");
  const suppressed = new Set(suppressedBaseRefs);
  const activeBaseFacts = constraints.filter(({ source, id }) => source !== "profile" && !suppressed.has(`constraint:${id}`))
    .map((constraint): EffectiveIntentBaseFact => ({
      ref: `constraint:${constraint.id}`,
      target: targetForConstraint(constraint),
      authority: persistedAuthority(constraint.source),
      strength: constraint.strength,
      scope: clone(constraint.scope),
      requirement: clone(constraint.requirement),
    }));
  const profileHints = constraints.filter(({ source, id }) => source === "profile" && !suppressed.has(`constraint:${id}`))
    .map((constraint): EffectiveIntentProfileHint => ({
      ref: `constraint:${constraint.id}`,
      target: targetForConstraint(constraint),
      strength: "soft",
      scope: clone(constraint.scope),
      requirement: clone(constraint.requirement),
    }));
  const base = {
    source: input.baseSource ?? "none" as const,
    ...(input.baseRevision === undefined ? {} : { revision: input.baseRevision }),
    fingerprint: fingerprint(input.baseRequest ?? null),
  };
  const activeBaseGoal = input.baseRequest?.goal && !suppressed.has("request:goal")
    ? { ref: "request:goal" as const, value: input.baseRequest.goal, authority: "persisted_user" as const } : undefined;
  const activeBaseParty = input.baseRequest?.party && input.baseRequest.party.source !== "profile" && !suppressed.has("request:party")
    ? { ref: "request:party" as const, value: clone(input.baseRequest.party),
      authority: (input.baseRequest.party.source === "user" ? "persisted_user" : input.baseRequest.party.source) as "persisted_user" | "legacy" | "assumption" } : undefined;
  const profilePartyHint = input.baseRequest?.party?.source === "profile" && !suppressed.has("request:party")
    ? { ref: "request:party" as const, value: clone(input.baseRequest.party), authority: "profile_hint" as const } : undefined;
  const semantic = {
    version: 1 as const,
    base,
    intentRevision: input.overlay.intentRevision,
    ...(activeBaseGoal ? { activeBaseGoal } : {}),
    ...(activeBaseParty ? { activeBaseParty } : {}),
    ...(profilePartyHint ? { profilePartyHint } : {}),
    activeBaseFacts,
    profileHints,
    actualConversationFacts,
    hypotheticalFacts,
    retractions: input.overlay.tombstones.map(clone),
    suppressedBaseRefs,
  };
  return { ...semantic, fingerprint: fingerprint(semantic) };
}

function targetForConstraint(constraint: TripConstraint): IntentTarget {
  switch (constraint.requirement.type) {
    case "origin": return "origin";
    case "destinations": return "destination";
    case "dates": return "start_date";
    case "duration": return "duration";
    case "budget": return "budget";
    case "experience": return "experience";
    case "pace": return "pace";
    case "depart_after": case "arrive_by": return "fixed_schedule";
    case "mobility": case "aggregate_metric": case "relative_distance": return "transport";
    case "adventure": return "experience";
  }
}

function persistedAuthority(source: TripConstraint["source"]): EffectiveIntentBaseFact["authority"] {
  if (source === "user") return "persisted_user";
  if (source === "legacy" || source === "assumption") return source;
  throw new Error("Profile constraint must be projected as a hint");
}

function clone<T>(value: T): T { return structuredClone(value); }

function fingerprint(value: unknown): string {
  const canonical = canonicalJson(value);
  let hash = 2166136261;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `intent-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
