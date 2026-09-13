import { describe, expect, it } from "vitest";
import { hazardTravelEvent, railTravelEvent } from "./travel-event-projection";
import { validateTravelEvent, travelEventId, type TravelEvent } from "./travel-event";
import { hazardInformation, hazardAlert } from "./hazard-alert.fixture";
import { railSelectionFixture } from "./selected-rail-journey.fixture";
import { watchTrip } from "./trip-watch.fixture";
import { isCurrentTripImpact, tripImpactId, validateTripImpact, type TripImpact } from "./trip-impact";
import type { TrainDelaySnapshot } from "@raiquora/operation/operation";

const now = "2026-09-13T00:10:00Z";
const subject = { type: "rail-service" as const, serviceDate: "2026-09-13", serviceUid: "s1", trainNumber: "1M" };
const railSource = { id: "rail-observation", kind: "event" as const, provider: "synthetic", sourceId: "operation-1", retrievedAt: now, confidence: "observed" as const };
const snapshot = (delay = 5): TrainDelaySnapshot => ({ collectedAt: now, failedSources: [], operationsByTrainNumber: new Map([
  ["1M", { delayMinutes: delay, destination: "B", sources: ["synthetic"], longTimeStopping: false }],
]) });
const index = () => railSelectionFixture().inputs[0]!.index;

describe("provider-independent TravelEvent seams", () => {
  it("dedupes repeated rail state despite new observation/evidence IDs; meaningful changes differ", () => {
    const first = railTravelEvent(subject, index(), snapshot(), [railSource], now);
    const next = railTravelEvent(subject, index(), { ...snapshot(), collectedAt: "2026-09-13T00:11:00Z" }, [{ ...railSource, id: "next", retrievedAt: "2026-09-13T00:11:00Z" }], "2026-09-13T00:11:00Z");
    expect(next.id).toBe(first.id); expect(next.observedAt).not.toBe(first.observedAt);
    expect(first.fact).toEqual({ status: "observed", delayMinutes: 5, destination: "B", longTimeStopping: false });
    expect(railTravelEvent(subject, index(), snapshot(10), [railSource], now).id).not.toBe(first.id);
    expect(first).not.toHaveProperty("operationsByTrainNumber");
    expect(first.fact).not.toHaveProperty("sources");
  });
  it("stale/partial/missing/ambiguous/different-date input never becomes on-time or cancellation", () => {
    expect(railTravelEvent(subject, index(), snapshot(), [railSource], "2026-09-13T00:30:00Z").freshness).toBe("stale");
    for (const s of [undefined, { ...snapshot(), failedSources: ["one"] }, { ...snapshot(), operationsByTrainNumber: new Map() }]) {
      const event = railTravelEvent(subject, index(), s, [railSource], now);
      expect(event.fact.status).not.toBe("observed"); expect(event.fact).not.toHaveProperty("delayMinutes"); expect(event.fact).not.toHaveProperty("cancelled");
    }
    expect(railTravelEvent(subject, { ...index(), service_date: "2026-09-14" }, snapshot(), [railSource], now).fact.status).toBe("unknown");
    expect(railTravelEvent(subject, { ...index(), trains: [...index().trains, { ...index().trains[0]!, service_uid: "other" }] }, snapshot(), [railSource], now).fact.status).toBe("unknown");
    expect(railTravelEvent({ ...subject, serviceUid: undefined }, index(), snapshot(), [railSource], now).fact.status).toBe("observed");
    expect(railTravelEvent({ ...subject, serviceUid: undefined }, index(), snapshot(), [railSource], now).subject).toEqual(subject);
  });
  it("rejects invalid delays, supports explicit cancellation facts without inferring missing operation", () => {
    expect(() => railTravelEvent(subject, index(), snapshot(NaN), [railSource], now)).toThrow();
    const base = railTravelEvent(subject, index(), snapshot(), [railSource], now);
    const event = { ...base, fact: { status: "observed" as const, cancelled: true } } as TravelEvent;
    expect(() => validateTravelEvent({ ...event, id: travelEventId(event) })).not.toThrow();
  });
  it("allowlists operation fields and does not treat future/forecast source metadata as observed", () => {
    const raw = snapshot(); Object.assign(raw.operationsByTrainNumber.get("1M")!, { rawProvider: "private", notified: true, currentLocation: [1, 2] });
    const result = railTravelEvent(subject, index(), raw, [railSource], now);
    expect(JSON.stringify(result)).not.toContain("rawProvider"); expect(JSON.stringify(result)).not.toContain("notified");
    expect(JSON.stringify(result)).not.toContain("currentLocation");
    expect(railTravelEvent(subject, index(), raw, [{ ...railSource, confidence: "provider-forecast" }], now).fact).toEqual({ status: "unknown", reason: "invalid" });
    expect(railTravelEvent(subject, index(), raw, [{ ...railSource, retrievedAt: "2026-09-14T00:10:00Z" }], now).fact.status).toBe("unknown");
  });
  it("preserves public hazard category/severity/identity/issued time/query scope, not Impact", () => {
    const original = hazardInformation([hazardAlert({ severity: "emergency" })]), copy = structuredClone(original);
    const event = hazardTravelEvent({ area: "大阪府" }, original, "2026-09-12T08:01:00Z");
    expect(event.subject).toEqual({ type: "hazard-area", area: "大阪府" });
    expect(event.fact).toMatchObject({ status: "observed", coverage: "query-limited", alerts: [{ providerAlertId: "synthetic-warning:Ａ", severity: "emergency", category: "warning", issuedAt: "2026-09-12T07:50:00Z" }] });
    expect(event).not.toHaveProperty("severity"); expect(event).not.toHaveProperty("notification");
    expect(original).toEqual(copy);
    const refreshed = structuredClone(original); refreshed.evidence[0]!.id = "new-evidence"; refreshed.evidence[0]!.retrievedAt = "2026-09-12T08:02:00Z";
    expect(hazardTravelEvent({ area: "大阪府" }, refreshed, "2026-09-12T08:02:00Z").id).toBe(event.id);
    expect(hazardTravelEvent({ area: "大阪府" }, hazardInformation(), "2026-09-12T08:01:00Z").id).not.toBe(event.id);
  });
  it("keeps failed hazard query scope; stale/empty are not safety certification; rejects raw fields", () => {
    const failed = hazardTravelEvent({ area: "大阪府" }, { status: "unavailable", freshness: "unknown", evidence: [] }, now);
    expect(failed.subject).toEqual({ type: "hazard-area", area: "大阪府" });
    expect(failed.fact).toEqual({ status: "unavailable", reason: "missing" });
    expect(hazardTravelEvent({ area: "大阪府" }, hazardInformation(), now).freshness).toBe("stale");
    expect(hazardTravelEvent({ area: "大阪府" }, hazardInformation([]), now).fact).toMatchObject({ coverage: "query-limited", alerts: [] });
    expect(() => validateTravelEvent({ ...failed, notified: true } as unknown as TravelEvent)).toThrow();
    expect(() => hazardTravelEvent({ area: "京都府" }, hazardInformation(), now)).toThrow();
    const raw = hazardInformation(); Object.assign(raw.data!.alerts[0]!, { rawXml: "payload" });
    expect(() => hazardTravelEvent({ area: "大阪府" }, raw, now)).toThrow();
  });
  it("hazard Evidence missing/future is unknown, and ordering of the same alert set is stable", () => {
    const missing = hazardInformation([]); missing.evidence = [];
    expect(hazardTravelEvent({ area: "大阪府" }, missing, now).fact.status).toBe("unknown");
    expect(hazardTravelEvent({ area: "大阪府" }, hazardInformation(), "2026-09-11T08:00:00Z").fact.status).toBe("unknown");
    const a = hazardAlert(), b = hazardAlert({ providerAlertId: "second", category: "earthquake" });
    expect(hazardTravelEvent({ area: "大阪府" }, hazardInformation([a, b]), now).id).toBe(
      hazardTravelEvent({ area: "大阪府" }, hazardInformation([b, a]), now).id);
  });
});

describe("TripImpact contract, not evaluation algorithm", () => {
  it("requires valid Trip revision, event and affected item, rejects notification/public severity", () => {
    const trip = watchTrip(), event = railTravelEvent(subject, index(), snapshot(), [railSource], now);
    const input: Omit<TripImpact, "id"> = { tripId: trip.id, tripRevision: 0, eventId: event.id, policyVersion: "synthetic-v1", facts: [], status: "unknown", severity: "informational", affectedItemIds: ["rail"], reasonCodes: ["external_data_unknown"], evaluatedAt: now };
    const impact = { ...input, id: tripImpactId(input) };
    expect(isCurrentTripImpact(impact, trip, event)).toBe(true);
    expect(isCurrentTripImpact(impact, { ...trip, revision: 1 }, event)).toBe(false);
    expect(isCurrentTripImpact(impact, { ...trip, items: [] }, event)).toBe(false);
    for (const extra of [{ notified: true }, { severity: "emergency" }, { tripRevision: -1 }, { eventId: "" }]) {
      expect(() => validateTripImpact({ ...impact, ...extra } as TripImpact)).toThrow();
    }
    expect(trip).not.toHaveProperty("impact"); expect(trip).not.toHaveProperty("delayMinutes");
  });
});
