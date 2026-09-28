/** #758: evidence ledger for the Trip-centred product evaluation.
 * Records observations, never user requests, provider payloads or conversation text. */
export const tripV2Scenarios = [
  "destination-interest", "experience-discovery", "concrete-itinerary", "branch-and-reload",
  "partial-failures", "condition-and-concurrency",
] as const;
export const tripV2Stages = ["state", "bedrock-fixed-provider", "real-provider", "desktop-browser", "mobile-browser", "deployed"] as const;
export type TripV2Scenario = typeof tripV2Scenarios[number];
export type TripV2Stage = typeof tripV2Stages[number];
export type ObservationStatus = "passed" | "failed" | "not_run";
export interface TripV2Observation {
  scenario: TripV2Scenario;
  stage: TripV2Stage;
  status: ObservationStatus;
  commit: string;
  runUrl?: string;
  reasons?: string[];
  /** Critical failures are never averaged into a quality score. */
  violations?: ("owner_boundary" | "unapproved_mutation" | "reservation_confusion")[];
  metrics?: { durationMs?: number; modelCalls?: number; toolCalls?: number; inputTokens?: number; outputTokens?: number };
}
export interface TripV2Report {
  version: "trip-v2-product-evaluation-v1";
  complete: boolean;
  observations: TripV2Observation[];
  missing: { scenario: TripV2Scenario; stage: TripV2Stage }[];
  failed: { scenario: TripV2Scenario; stage: TripV2Stage; reasons: string[] }[];
}

export function evaluateTripV2Product(observations: TripV2Observation[]): TripV2Report {
  const entries = new Map<string, TripV2Observation>();
  for (const observation of observations) {
    if (!observation || typeof observation !== "object") throw new Error("invalid observation");
    if (!tripV2Scenarios.includes(observation.scenario) || !tripV2Stages.includes(observation.stage)) throw new Error("unknown scenario or stage");
    if (!["passed", "failed", "not_run"].includes(observation.status)) throw new Error("invalid status");
    if (!/^[0-9a-f]{40}$/u.test(observation.commit)) throw new Error("invalid commit SHA");
    if (observation.runUrl && !/^https:\/\/github\.com\/ymho\/transitforge\/actions\/runs\/[0-9]+$/u.test(observation.runUrl))
      throw new Error("invalid run URL");
    if (observation.status === "passed" && !observation.runUrl) throw new Error("passed observation requires a verifiable run URL");
    if ((observation.violations ?? []).some(v => !["owner_boundary", "unapproved_mutation", "reservation_confusion"].includes(v)))
      throw new Error("invalid critical violation");
    if ((observation.reasons ?? []).some(reason => !/^[a-z][a-z0-9_]{0,79}$/u.test(reason)))
      throw new Error("reason must be a bounded diagnostic code");
    for (const value of Object.values(observation.metrics ?? {})) {
      if (!Number.isSafeInteger(value) || value < 0) throw new Error("invalid metric");
    }
    const key = `${observation.scenario}/${observation.stage}`;
    if (entries.has(key)) throw new Error(`duplicate observation: ${key}`);
    entries.set(key, observation);
  }
  const missing: TripV2Report["missing"] = [], failed: TripV2Report["failed"] = [];
  for (const scenario of tripV2Scenarios) for (const stage of tripV2Stages) {
    const observation = entries.get(`${scenario}/${stage}`);
    if (!observation || observation.status === "not_run") { missing.push({ scenario, stage }); continue; }
    const reasons = [...(observation.reasons ?? []), ...(observation.violations ?? []).map(v => `critical:${v}`)];
    if (observation.status === "failed" || reasons.length) failed.push({ scenario, stage,
      reasons: reasons.length ? reasons : ["evaluation_failed"] });
  }
  return { version: "trip-v2-product-evaluation-v1", complete: missing.length === 0 && failed.length === 0,
    observations, missing, failed };
}
