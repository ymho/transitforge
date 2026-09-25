import type { ConversationIntentFact, ConversationIntentOverlay, ConversationIntentTombstone, IntentTarget } from "@raiquora/trip/conversation-intent";
import type { TripConstraint, TripRequest } from "@raiquora/trip/trip-request";
import type { TripParty } from "@raiquora/trip/trip-party";
import { travelPreferenceLabels, type UserProfile } from "@raiquora/trip/travel-profile";

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
  attribute: string;
  strength: "soft";
  scope: TripConstraint["scope"];
  requirement: TripConstraint["requirement"];
  source: { kind: "trip_request_profile" | "user_profile"; profileVersion?: number; profileRevision?: number; path: string };
  application: "reference_only";
}

export interface IgnoredProfileSetting {
  path: string;
  reason: "trip_specific" | "unused_setting" | "consent_required";
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
  /** Persisted conditions not shadowed by an explicit current conversation operation. */
  activeBaseFacts: EffectiveIntentBaseFact[];
  /** Profile values remain hints and never acquire user-turn authority. */
  profileHints: EffectiveIntentProfileHint[];
  ignoredProfileSettings: IgnoredProfileSetting[];
  actualConversationFacts: ConversationIntentFact[];
  hypotheticalFacts: ConversationIntentFact[];
  retractions: ConversationIntentTombstone[];
  suppressedBaseRefs: string[];
  profileSuppressions: NonNullable<TripRequest["profileSuppressions"]>;
  fingerprint: string;
}

/** Pure compiler shared by model/Tool/UI projections. It never mutates the base Request
 * and never upgrades Profile/model/legacy authority to a current user statement. */
export function compileEffectiveIntent(input: {
  baseRequest?: TripRequest;
  baseSource?: "trip" | "conversation_draft";
  baseRevision?: number;
  profile?: UserProfile;
  profileRevision?: number;
  overlay: ConversationIntentOverlay;
}): EffectiveIntent {
  const constraints = input.baseRequest?.constraints ?? [];
  const actualConversationFacts = input.overlay.facts.filter(({ frame }) => frame === "actual").map(clone);
  const hypotheticalFacts = input.overlay.facts.filter(({ frame }) => frame === "hypothetical").map(clone);
  const actualRetractions = input.overlay.tombstones.filter(({ frame }) => frame === "actual");
  const suppressedBaseRefs = constraints.filter((constraint) => suppressedByConversation(constraint, actualConversationFacts, actualRetractions))
    .map(({ id }) => `constraint:${id}`);
  if (input.baseRequest?.goal && targetSuppressed("goal", actualConversationFacts, actualRetractions)) suppressedBaseRefs.push("request:goal");
  if (input.baseRequest?.party && targetSuppressed("party_size", actualConversationFacts, actualRetractions)) suppressedBaseRefs.push("request:party");
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
  const profileSuppressions = input.baseRequest?.profileSuppressions?.map(clone) ?? [];
  const requestProfileHints = constraints.filter(({ source, id }) => source === "profile" && !suppressed.has(`constraint:${id}`))
    .map((constraint): EffectiveIntentProfileHint => ({
      ref: `constraint:${constraint.id}`,
      target: targetForConstraint(constraint),
      attribute: constraintAttribute(constraint),
      strength: "soft",
      scope: clone(constraint.scope),
      requirement: clone(constraint.requirement),
      source: { kind: "trip_request_profile", path: `request.constraints.${constraint.id}` },
      application: "reference_only",
    }));
  const directProfile = input.profile ? userProfileHints(input.profile, input.profileRevision) : { hints: [], ignored: [] };
  const profileHints = [...requestProfileHints, ...directProfile.hints].filter((hint) => !profileSuppressed(hint, profileSuppressions)).filter((hint) =>
    !hintSuppressed(hint, actualConversationFacts, actualRetractions) &&
    !activeBaseFacts.some((baseFact) => sameHintAttribute(baseFact, hint)));
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
  const ignoredProfileSettings = [...directProfile.ignored,
    ...(input.baseRequest?.party?.source === "profile" ? [{ path: "request.party", reason: "trip_specific" as const }] : [])];
  const semantic = {
    version: 1 as const,
    base,
    intentRevision: input.overlay.intentRevision,
    ...(activeBaseGoal ? { activeBaseGoal } : {}),
    ...(activeBaseParty ? { activeBaseParty } : {}),
    activeBaseFacts,
    profileHints,
    ignoredProfileSettings,
    actualConversationFacts,
    hypotheticalFacts,
    retractions: input.overlay.tombstones.map(clone),
    suppressedBaseRefs,
    profileSuppressions,
  };
  return { ...semantic, fingerprint: fingerprint(semantic) };
}

function profileSuppressed(hint: EffectiveIntentProfileHint, suppressions: NonNullable<TripRequest["profileSuppressions"]>): boolean {
  return suppressions.some((suppression) => suppression.target === hint.target && scopeOverrides(hint.scope, suppression.scope));
}

/** Compatibility presentation for recommendation binding, derived only from the
 * already-resolved hints so model context cannot choose a different precedence. */
export function effectiveProfileContext(effective: EffectiveIntent): Record<string, unknown> | undefined {
  const profileHints = effective.profileHints.filter(({ source }) => source.kind === "user_profile");
  if (!profileHints.length) return undefined;
  const interestHints = profileHints.filter(({ attribute, requirement }) => attribute.startsWith("interest:") && requirement.type === "experience");
  const pace = profileHints.find(({ attribute, requirement }) => attribute === "pace" && requirement.type === "pace");
  const origin = profileHints.find(({ target, requirement }) => target === "origin" && requirement.type === "origin");
  const notes = Object.fromEntries(profileHints.filter(({ attribute }) => attribute.startsWith("note:"))
    .map(({ attribute, requirement }) => [attribute.slice("note:".length), requirement.type === "experience" ? requirement.text : ""]));
  const source = profileHints[0]!.source;
  return {
    source: { profileVersion: source.profileVersion, ...(source.profileRevision === undefined ? {} : { profileRevision: source.profileRevision }) },
    application: "reference_only",
    ...(origin?.requirement.type === "origin" ? { home: origin.source.path === "home.area"
      ? { area: origin.requirement.place.name } : { station: origin.requirement.place.name } } : {}),
    favoriteInterests: interestHints.map(({ requirement }) => requirement.type === "experience" ? requirement.text : ""),
    ...(pace?.requirement.type === "pace" ? { pace: pace.requirement.value } : {}),
    preferenceHints: profileHints.map(({ ref, target, attribute, requirement, source: hintSource }) =>
      ({ ref, target, attribute, requirement: clone(requirement), path: hintSource.path })),
    ...(Object.keys(notes).length ? { consentedPreferenceNotes: notes } : {}),
  };
}

function targetForConstraint(constraint: TripConstraint): IntentTarget {
  const semanticTarget = constraint.semantic?.facts[0]?.target;
  if (semanticTarget) return semanticTarget;
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

function constraintAttribute(constraint: TripConstraint): string {
  const requirement = constraint.requirement;
  if (requirement.type === "experience") return requirement.preference
    ? `interest:${requirement.preference}` : `experience:${normalize(requirement.text)}`;
  if (requirement.type === "mobility") return `mobility:${Object.keys(requirement).filter((key) => key !== "type").sort().join("+")}`;
  return requirement.type;
}

function suppressedByConversation(constraint: TripConstraint, facts: ConversationIntentFact[], tombstones: ConversationIntentTombstone[]): boolean {
  const target = targetForConstraint(constraint);
  const relevantFacts = facts.filter((fact) => fact.target === target && scopeOverrides(constraint.scope, fact.scope));
  if (tombstones.some((item) => item.target === target && scopeOverrides(constraint.scope, item.scope))) return true;
  if (target !== "experience") return relevantFacts.length > 0;
  return relevantFacts.some((fact) => fact.value.kind === "unknown" || experienceFactMatches(constraint, fact));
}

function targetSuppressed(target: IntentTarget, facts: ConversationIntentFact[], tombstones: ConversationIntentTombstone[]): boolean {
  return facts.some((fact) => fact.target === target && globalIntentScope(fact.scope)) ||
    tombstones.some((item) => item.target === target && globalIntentScope(item.scope));
}

function hintSuppressed(hint: EffectiveIntentProfileHint, facts: ConversationIntentFact[], tombstones: ConversationIntentTombstone[]): boolean {
  const relevant = facts.filter((fact) => fact.target === hint.target && scopeOverrides(hint.scope, fact.scope));
  if (tombstones.some((item) => item.target === hint.target && scopeOverrides(hint.scope, item.scope))) return true;
  if (hint.target !== "experience") return relevant.length > 0;
  return relevant.some((fact) => fact.value.kind === "unknown" || hintExperienceMatches(hint, fact));
}

function scopeOverrides(base: TripConstraint["scope"], operation: ConversationIntentFact["scope"]): boolean {
  if (globalIntentScope(operation)) return base.type === "trip" || base.type === "all-days";
  if (operation.type === "logical_day") return base.type === "logical-day" && base.logicalDayId === operation.logicalDayId;
  if (operation.type === "segment") return base.type === "segment" && base.segmentId === operation.segmentId;
  return false;
}

function globalIntentScope(scope: ConversationIntentFact["scope"]): boolean {
  return scope.type === "conversation" || scope.type === "trip";
}

function experienceFactMatches(constraint: TripConstraint, fact: ConversationIntentFact): boolean {
  if (constraint.requirement.type !== "experience" || fact.value.kind !== "text") return false;
  const factText = normalize(fact.value.text);
  const values = [constraint.requirement.text,
    constraint.requirement.preference ? travelPreferenceLabels[constraint.requirement.preference] : undefined,
    constraint.requirement.preference].filter((value): value is string => Boolean(value)).map(normalize);
  return values.some((value) => factText.includes(value) || value.includes(factText));
}

function hintExperienceMatches(hint: EffectiveIntentProfileHint, fact: ConversationIntentFact): boolean {
  if (fact.value.kind !== "text" || hint.requirement.type !== "experience") return false;
  return experienceFactMatches({ id: hint.ref, strength: "soft", source: "profile", scope: hint.scope,
    requirement: hint.requirement }, fact);
}

function sameHintAttribute(base: EffectiveIntentBaseFact, hint: EffectiveIntentProfileHint): boolean {
  return base.target === hint.target && constraintAttribute({ id: base.ref, strength: base.strength, source: "user",
    scope: base.scope, requirement: base.requirement }) === hint.attribute;
}

function userProfileHints(profile: UserProfile, profileRevision?: number): { hints: EffectiveIntentProfileHint[]; ignored: IgnoredProfileSetting[] } {
  const hints: EffectiveIntentProfileHint[] = [];
  const add = (path: string, target: IntentTarget, attribute: string, requirement: TripConstraint["requirement"]) => hints.push({
    ref: `profile:v${profile.version}:${path}`, target, attribute, strength: "soft", scope: { type: "trip" }, requirement,
    source: { kind: "user_profile", profileVersion: profile.version, ...(profileRevision === undefined ? {} : { profileRevision }), path },
    application: "reference_only",
  });
  const origin = profile.home.station?.trim() || profile.home.area?.trim();
  if (origin) add(profile.home.station?.trim() ? "home.station" : "home.area", "origin", "origin",
    { type: "origin", place: { name: origin, sources: [] } });
  for (const [preference, weight] of Object.entries(profile.preferences) as Array<[keyof typeof travelPreferenceLabels, number]>) {
    add(`preferences.${preference}`, "experience", `interest:${preference}`,
      { type: "experience", intent: "prefer", text: travelPreferenceLabels[preference], preference, weight });
  }
  if (profile.travelStyle.pace !== undefined) add("travelStyle.pace", "pace", "pace", { type: "pace", value: profile.travelStyle.pace });
  if (profile.transport.preferredMode) add("transport.preferredMode", "transport", "mobility:modes",
    { type: "mobility", modes: [profile.transport.preferredMode === "walking" ? "walk" : profile.transport.preferredMode] });
  if (profile.home.carAvailable !== undefined) add("home.carAvailable", "transport", "mobility:carAvailable",
    { type: "mobility", carAvailable: profile.home.carAvailable });
  const toleranceLabels: Partial<Record<keyof UserProfile["travelStyle"], string>> = {
    crowdTolerance: "混雑", walkingTolerance: "長時間歩行", transferTolerance: "乗換",
    earlyMorningTolerance: "早朝出発", lateNightTolerance: "夜遅い到着", drivingTolerance: "車の運転", busTolerance: "バス移動",
  };
  for (const [key, label] of Object.entries(toleranceLabels) as Array<[keyof UserProfile["travelStyle"], string]>) {
    const value = profile.travelStyle[key];
    if (value !== undefined) add(`travelStyle.${key}`, key === "transferTolerance" || key === "walkingTolerance" || key === "drivingTolerance" || key === "busTolerance"
      ? "transport" : "experience", `tolerance:${key}`,
      { type: "experience", intent: value <= 0.35 ? "avoid" : "prefer", text: `${label}の許容度`, weight: value });
  }
  for (const key of ["lodging", "food", "avoidances"] as const) {
    const value = profile.notes?.[key]?.trim();
    if (value && profile.aiNoteFields?.includes(key)) add(`notes.${key}`, key === "lodging" ? "accommodation" : "experience", `note:${key}`,
      { type: "experience", intent: key === "avoidances" ? "avoid" : "prefer", text: value });
  }
  const ignored: IgnoredProfileSetting[] = [];
  if (profile.companions.usual.length) ignored.push({ path: "companions.usual", reason: "trip_specific" });
  if (profile.companions.children.length) ignored.push({ path: "companions.children", reason: "trip_specific" });
  if (profile.companions.usualPartySize !== undefined) ignored.push({ path: "companions.usualPartySize", reason: "trip_specific" });
  if (profile.transport.maxTypicalTravelMinutes !== undefined) ignored.push({ path: "transport.maxTypicalTravelMinutes", reason: "trip_specific" });
  if (profile.travelStyle.novelty !== undefined) ignored.push({ path: "travelStyle.novelty", reason: "unused_setting" });
  if (profile.notes?.budget) ignored.push({ path: "notes.budget", reason: "trip_specific" });
  for (const key of ["lodging", "food", "avoidances"] as const) if (profile.notes?.[key] && !profile.aiNoteFields?.includes(key)) {
    ignored.push({ path: `notes.${key}`, reason: "consent_required" });
  }
  return { hints, ignored };
}

function normalize(value: string): string { return value.normalize("NFKC").replace(/\s+/gu, "").toLowerCase(); }

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
