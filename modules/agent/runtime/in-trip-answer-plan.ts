import type { Evidence, EvidenceCoverage, EvidenceSourceType } from "./evidence-model";

export const inTripPresentations = ["planned-itinerary", "rail-impact", "environment-impact",
  "reservation", "location-permission", "uncertainty", "external-result"] as const;
export type InTripPresentation = typeof inTripPresentations[number];
export interface InTripAnswerPlan {
  evidence: Array<{ evidenceId: string; presentation: InTripPresentation }>;
}

/** Bounded wire contract for newly collected Tool Evidence. Retained for the shared model wire parser. */
export function validInTripAnswerPlan(value: unknown): value is InTripAnswerPlan {
  if (!record(value) || Object.keys(value).some((k) => k !== "evidence") || !Array.isArray(value.evidence) ||
      value.evidence.length < 1 || value.evidence.length > 6) return false;
  const identities = new Set<string>();
  return value.evidence.every((e) => {
    if (!record(e) || Object.keys(e).some((k) => !["evidenceId", "presentation"].includes(k)) ||
        typeof e.evidenceId !== "string" || !e.evidenceId.length || e.evidenceId.length > 160 || e.evidenceId.trim() !== e.evidenceId ||
        !inTripPresentations.includes(e.presentation as InTripPresentation)) return false;
    const key = `${e.evidenceId}/${e.presentation}`;
    if (identities.has(key)) return false;
    identities.add(key); return true;
  });
}

const contracts: Record<Exclude<InTripPresentation, "uncertainty" | "external-result">, { source: EvidenceSourceType; coverage: EvidenceCoverage[] }> = {
  "planned-itinerary": { source: "trip-state", coverage: ["trip.itinerary", "trip.next-item"] },
  "rail-impact": { source: "trip-impact", coverage: ["rail.impact", "rail.connection"] },
  "environment-impact": { source: "trip-impact", coverage: ["weather.impact", "hazard.impact"] },
  reservation: { source: "reservation-state", coverage: ["reservation.state"] },
  "location-permission": { source: "session-state", coverage: ["location.permission"] },
};

/** A presentation is supported by an Application projection, not an arbitrary Context/model summary. */
export function supportsInTripPresentation(e: Evidence, presentation: InTripPresentation): boolean {
  if (presentation === "external-result") return e.knowledgeKind === "deterministic_fact" &&
    e.references.length > 0 && e.references.every((r) => r.sourceType === "external-source") &&
    ["weather", "hazard"].includes(String(e.facts.resultKind));
  if (!e.references.length || !e.references.every((r) => r.sourceRef.startsWith("application://in-trip/v1/"))) return false;
  if (e.knowledgeKind === "model_interpretation") return false;
  if (e.coverage?.some((c) => c === "weather.impact" || c === "hazard.impact")) return presentation === "environment-impact" &&
    e.references.every((r) => r.sourceType === "trip-impact" && r.sourceRef.endsWith("/environment")) && typeof e.facts.impacts === "string";
  if (presentation === "environment-impact") return false;
  if (presentation === "uncertainty") return e.references.every((r) => ["trip-state", "trip-impact"].includes(r.sourceType)) &&
    (e.knowledgeKind === "unverified_information" || typeof e.facts.typedFacts === "string" &&
      array<Record<string, unknown>>(e.facts.typedFacts).some((f) => f.type === "uncertainty"));
  const c = contracts[presentation];
  if (c.source !== "trip-impact" && e.knowledgeKind !== "deterministic_fact") return false;
  return e.references.length > 0 && e.references.every((r) => r.sourceType === c.source) &&
    c.coverage.some((scope) => e.coverage?.includes(scope));
}

function record(v: unknown): v is Record<string, unknown> { return typeof v === "object" && v !== null && !Array.isArray(v); }

function array<T>(value: unknown): T[] {
  if (typeof value !== "string") throw new Error("invalid_presentation_facts");
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.length > 8) throw new Error("invalid_presentation_facts");
  return parsed as T[];
}
