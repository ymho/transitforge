import type { TrainDelaySnapshot } from "@raiquora/operation/operation";
import { isInOperatingDay } from "@raiquora/operation/operating-day";
import { realtimeSnapshotToleranceMilliseconds } from "@raiquora/operation/train-operation-state";
import type { TrainIndex, Train } from "@raiquora/train/train";
import { parseHazardAlertQuery, validateHazardAlertInformation, type HazardAlertQuery, type HazardAlertSearchResult } from "./hazard-alert";
import { externalInformationFreshness, type ExternalSourceEvidence, type ExternalTravelInformation } from "./external-travel-information";
import { validInstant } from "./snapshot-validation";
import { validateWatchSubject, type WatchSubject } from "./trip-watch";
import { travelEventId, validateTravelEvent, type TravelEvent, type RailEventFact, type HazardEventFact } from "./travel-event";

function observation(at: string, sources: readonly ExternalSourceEvidence[]) {
  if (!validInstant(at)) throw new Error("Observation instant required");
  return { observedAt: at, sources: structuredClone(sources), sourceEvidenceIds: [...new Set(sources.map((s) => s.id))].sort() };
}
/** Query is required even when the provider failed and returned no data/area. */
export function hazardTravelEvent(query: HazardAlertQuery, result: ExternalTravelInformation<HazardAlertSearchResult>, observedAt: string): TravelEvent {
  const scope = parseHazardAlertQuery(query); validateHazardAlertInformation(result);
  if (result.data && (result.data.area !== scope.area || result.data.alerts.some((a) => scope.categories && !scope.categories.includes(a.category)))) throw new Error("Hazard query/result mismatch");
  let fact: HazardEventFact = result.status === "available" && !result.evidence.length ? { status: "unknown", reason: "missing" } : result.status === "available" ? {
    status: "observed", coverage: "query-limited", queriedCategories: [...(scope.categories ?? [])].sort(),
    alerts: result.data!.alerts.map((a) => ({ providerAlertId: a.providerAlertId, category: a.category, severity: a.severity,
      title: a.title, summary: a.summary, issuedAt: a.issuedAt, sourceUrl: a.sourceUrl, ...(a.issuer === undefined ? {} : { issuer: a.issuer }) }))
      .sort((a, b) => a.providerAlertId < b.providerAlertId ? -1 : a.providerAlertId > b.providerAlertId ? 1 : 0),
  } : { status: result.status, reason: result.failure ? "failed" : "missing" };
  if (result.evidence.some((s) => Date.parse(s.retrievedAt) > Date.parse(observedAt)) ||
      result.data?.alerts.some((a) => Date.parse(a.issuedAt) > Date.parse(observedAt))) fact = { status: "unknown", reason: "invalid" };
  const computed = externalInformationFreshness(result.evidence, new Date(observedAt));
  const freshness = fact.status !== "observed" ? "unknown" : result.freshness === "stale" || computed === "stale" ? "stale" : result.freshness === "fresh" && computed === "fresh" ? "fresh" : "unknown";
  const event: TravelEvent = { id: "", kind: "hazard", subject: { type: "hazard-area", area: scope.area },
    ...observation(observedAt, result.evidence), freshness, fact };
  const complete = { ...event, id: travelEventId(event) }; validateTravelEvent(complete); return complete;
}

/** Existing operations are keyed by train number, not dated UID. Bind against a verified date-specific
 * timetable first. Ambiguous numbers, missing entries and partial snapshots are never cancellation/on-time.
 * Explicit cancellation can be supplied by a future validated operation adapter via RailEventFact.
 */
export function railTravelEvent(subject: Extract<WatchSubject, { type: "rail-service" }>,
  index: Pick<TrainIndex, "service_date"> & { trains: readonly Pick<Train, "service_uid" | "train_no">[] }, snapshot: TrainDelaySnapshot | undefined, sources: readonly ExternalSourceEvidence[], now: string): TravelEvent {
  validateWatchSubject(subject);
  if (!validInstant(now)) throw new Error("Clock instant required");
  let fact: RailEventFact = { status: "unknown", reason: "identity-unresolved" };
  let freshness: TravelEvent["freshness"] = "unknown";
  const matches = index.service_date === subject.serviceDate ? index.trains.filter((t) => subject.serviceUid === undefined
    ? t.train_no === subject.trainNumber : t.service_uid === subject.serviceUid && (subject.trainNumber === undefined || t.train_no === subject.trainNumber)) : [];
  const bound = matches.length === 1 && index.trains.filter((t) => t.train_no === matches[0]!.train_no).length === 1 ? matches[0] : undefined;
  if (bound) {
    if (!snapshot) fact = { status: "unavailable", reason: "missing" };
    else if (!validInstant(snapshot.collectedAt) || !isInOperatingDay(snapshot.collectedAt, subject.serviceDate)) fact = { status: "unknown", reason: "invalid" };
    else if (snapshot.failedSources.length) fact = { status: "unavailable", reason: "failed" };
    else {
      freshness = Math.abs(Date.parse(now) - Date.parse(snapshot.collectedAt)) > realtimeSnapshotToleranceMilliseconds ? "stale" : "fresh";
      const operation = snapshot.operationsByTrainNumber.get(bound.train_no);
      if (!operation || !sources.length) fact = { status: "unknown", reason: "missing" };
      else if (sources.some((s) => s.confidence !== "observed" || s.kind !== "event" ||
          Date.parse(s.retrievedAt) > Date.parse(now) || Date.parse(s.retrievedAt) < Date.parse(snapshot.collectedAt) ||
          s.observedAt !== undefined && Date.parse(s.observedAt) !== Date.parse(snapshot.collectedAt) ||
          s.validFrom !== undefined && Date.parse(s.validFrom) > Date.parse(now))) fact = { status: "unknown", reason: "invalid" };
      else fact = { status: "observed", delayMinutes: operation.delayMinutes,
        ...(operation.destination ? { destination: operation.destination } : {}),
        ...(operation.longTimeStopping === undefined ? {} : { longTimeStopping: operation.longTimeStopping }) };
    }
  }
  if (freshness === "fresh" && sources.some((s) => s.validUntil && Date.parse(s.validUntil) < Date.parse(now))) freshness = "stale";
  if (fact.status !== "observed") freshness = "unknown";
  // A unique verified timetable binding can supply its UID even when the upstream poll used only a number.
  // This makes its event address the same canonical subject as the adopted rail watch.
  const serviceUid = bound?.service_uid || subject.serviceUid, trainNumber = bound?.train_no ?? subject.trainNumber;
  const event: TravelEvent = { id: "", kind: "rail-operation", subject: { type: "rail-service", serviceDate: subject.serviceDate,
    ...(serviceUid === undefined ? {} : { serviceUid }), ...(trainNumber === undefined ? {} : { trainNumber }) },
    ...observation(snapshot && validInstant(snapshot.collectedAt) ? snapshot.collectedAt : now, sources), freshness, fact };
  const complete = { ...event, id: travelEventId(event) }; validateTravelEvent(complete); return complete;
}
