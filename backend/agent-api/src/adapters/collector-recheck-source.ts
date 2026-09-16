import { railTravelEvent } from "@raiquora/trip/travel-event-projection";
import type { WatchSubject } from "@raiquora/trip/trip-watch";
import type { TrainDelaySnapshot, TrainOperation } from "@raiquora/operation/operation";
import type { JourneyDataRepository } from "../ports/journey-data.js";
import { RecheckFailure } from "../contracts/trip-recheck.js";

/** Reads the EXISTING common collector snapshot. No operator API, per-Trip poller or inferred delay. */
export class CollectorRecheckSource {
  private snapshot?: ReturnType<JourneyDataRepository["loadRealtimeSnapshot"]>;
  private readonly indices = new Map<string, ReturnType<JourneyDataRepository["loadIndex"]>>();
  constructor(private readonly data: JourneyDataRepository) {}
  async event(subject: Extract<WatchSubject, { type: "rail-service" }>, now: number) {
    let load = this.indices.get(subject.serviceDate);
    if (!load) { load = this.data.loadIndex(subject.serviceDate, "direct-service"); this.indices.set(subject.serviceDate, load); }
    const [index, raw] = await Promise.all([load, this.snapshot ??= this.data.loadRealtimeSnapshot()]);
    if (index.schema_version !== "direct-service-index-v1" || index.service_date !== subject.serviceDate || !record(index.services)) throw new RecheckFailure("invalid_response");
    const trains = Object.values(index.services).map((service) => {
      if (!record(service) || typeof service.service_uid !== "string" || !service.service_uid || typeof service.train_no !== "string" || !service.train_no) throw new RecheckFailure("invalid_response");
      return { service_uid: service.service_uid, train_no: service.train_no };
    });
    if (!raw) throw new RecheckFailure("unavailable");
    if (typeof raw.collectedAt !== "string" || !Number.isFinite(Date.parse(raw.collectedAt)) || !Array.isArray(raw.failedSources) ||
        !raw.failedSources.every((v) => typeof v === "string") || !record(raw.trains)) throw new RecheckFailure("invalid_response");
    const operations = new Map<string, TrainOperation>();
    for (const [number, v] of Object.entries(raw.trains)) {
      if (!record(v) || typeof v.delayMinutes !== "number" || !Number.isFinite(v.delayMinutes) || v.delayMinutes < 0 ||
          typeof v.destination !== "string" || !Array.isArray(v.sources) || !v.sources.every((s) => typeof s === "string") ||
          v.longTimeStopping !== undefined && typeof v.longTimeStopping !== "boolean") throw new RecheckFailure("invalid_response");
      operations.set(number, { delayMinutes: v.delayMinutes, destination: v.destination, sources: v.sources as string[],
        ...(v.longTimeStopping === undefined ? {} : { longTimeStopping: v.longTimeStopping }) });
    }
    const snapshot: TrainDelaySnapshot = { collectedAt: raw.collectedAt, failedSources: raw.failedSources as string[], operationsByTrainNumber: operations };
    return railTravelEvent(subject, { service_date: subject.serviceDate, trains }, snapshot, [{
      id: `collector:${raw.collectedAt}`, kind: "event", provider: "common-rail-collector", sourceId: "api/traffic/delays.json",
      observedAt: raw.collectedAt, retrievedAt: new Date(now).toISOString(),
      validUntil: new Date(Date.parse(raw.collectedAt) + 300_000).toISOString(), confidence: "observed" }], new Date(now).toISOString());
  }
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
