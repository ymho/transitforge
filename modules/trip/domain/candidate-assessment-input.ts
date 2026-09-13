import type { ExternalSourceEvidence, ExternalTravelInformation } from "./external-travel-information";
import { validateExternalSourceEvidence } from "./external-travel-information";
import { validInstant } from "./snapshot-validation";
import type { CandidateFreshnessAssessment, CandidateReasonCode, TravelCandidateAssessment } from "./travel-candidate-assessment";

/** Validate each fact independently: one malformed/failed Tool cannot erase other candidate facts. */
export class CandidateFactReader {
  readonly sources = new Map<string, ExternalSourceEvidence>();
  readonly freshness = new Map<string, CandidateFreshnessAssessment>();
  readonly caveats: TravelCandidateAssessment["caveats"] = [];
  constructor(readonly now: string) {
    if (!validInstant(now)) throw new Error("Invalid assessment time");
  }
  read<T>(category: TravelCandidateAssessment["caveats"][number]["category"], input: ExternalTravelInformation<T> | undefined,
    kinds: ExternalSourceEvidence["kind"][], validate: (value: T) => void, current = false): {
      data?: T; evidenceIds: string[]; reason?: CandidateReasonCode; unavailable?: boolean;
    } {
    if (!input) return { evidenceIds: [], reason: "missing-facts" };
    try {
      if (!["available", "unavailable", "unknown"].includes(input.status) ||
          !["fresh", "stale", "unknown"].includes(input.freshness) || !Array.isArray(input.evidence)) throw new Error("Invalid external result");
      if (input.status === "available" && input.failure) throw new Error("Conflicting success/failure");
      const entries = input.evidence.map((source) => this.source(source, kinds, input.status, input.freshness));
      if (new Set(entries.map(([s]) => s.id)).size !== entries.length) throw new Error("Duplicate source");
      // Commit only after validating the entire set. Conflicting IDs cannot bless unrelated data.
      for (const [source, freshness] of entries) {
        const previous = this.sources.get(source.id);
        if (previous && JSON.stringify(previous) !== JSON.stringify(source)) throw new Error("Conflicting source ID");
        const previousFreshness = this.freshness.get(source.id);
        if (previousFreshness && previousFreshness.status !== freshness.status) throw new Error("Conflicting source freshness");
      }
      for (const [source, freshness] of entries) { this.sources.set(source.id, source); this.freshness.set(source.id, freshness); }
      const evidenceIds = entries.map(([s]) => s.id);
      if (input.status === "unavailable") return { evidenceIds, reason: "api-unavailable", unavailable: true };
      if (input.status !== "available" || !entries.length || input.data === undefined) return { evidenceIds, reason: "missing-facts" };
      validate(input.data);
      if (entries.some(([, f]) => f.status === "stale")) return { evidenceIds, reason: "stale-facts" };
      if (current && entries.some(([, f]) => f.status !== "fresh")) return { evidenceIds, reason: "freshness-unknown" };
      return { data: input.data, evidenceIds };
    } catch {
      this.caveats.push({ category, code: "invalid-facts" });
      return { evidenceIds: [], reason: "invalid-facts" };
    }
  }
  private source(input: ExternalSourceEvidence, kinds: ExternalSourceEvidence["kind"][], status: string, freshness: string):
    [ExternalSourceEvidence, CandidateFreshnessAssessment] {
    // Existing weather/ground providers cite request URLs with query parameters. Retain their
    // sourceId, not coordinates/API tokens from the request URL. Never strip into a different ID.
    if (input.sourceUrl) {
      const url = new URL(input.sourceUrl);
      if (url.search || url.hash) {
        if (!input.sourceId || url.protocol !== "https:" || url.username || url.password) throw new Error("No safe source reference");
        const { sourceUrl: _, ...withoutRequestUrl } = input;
        input = withoutRequestUrl;
      }
    }
    validateExternalSourceEvidence(input);
    if (!kinds.includes(input.kind) || input.confidence === "unknown" || Date.parse(input.retrievedAt) > Date.parse(this.now) ||
        input.observedAt && Date.parse(input.observedAt) > Date.parse(input.retrievedAt)) throw new Error("Unverified source");
    const source: ExternalSourceEvidence = { id: input.id, kind: input.kind, provider: input.provider,
      retrievedAt: input.retrievedAt, confidence: input.confidence,
      ...(input.sourceId ? { sourceId: input.sourceId } : {}), ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
      ...(input.observedAt ? { observedAt: input.observedAt } : {}), ...(input.validFrom ? { validFrom: input.validFrom } : {}),
      ...(input.validUntil ? { validUntil: input.validUntil } : {}) };
    const state = status === "unavailable" ? "unavailable" : freshness === "stale" ||
      input.validUntil && Date.parse(input.validUntil) < Date.parse(this.now) ? "stale" :
      freshness === "fresh" && input.validUntil && (!input.validFrom || Date.parse(input.validFrom) <= Date.parse(this.now)) ? "fresh" : "unknown";
    return [source, { evidenceId: source.id, status: state, retrievedAt: source.retrievedAt,
      ...(source.observedAt ? { observedAt: source.observedAt } : {}), ...(source.validUntil ? { validUntil: source.validUntil } : {}) }];
  }
}
