import { describe, expect, it } from "vitest";
import { evaluateRailTripImpact, railImpactPolicyVersion } from "./rail-trip-impact";
import { impactInput, impactEvent } from "./rail-trip-impact.fixture";
import { travelEventId, type TravelEvent } from "./travel-event";
import { validateTripImpact, tripImpactId } from "./trip-impact";
import { railScheduledInstant } from "./itinerary-schedule";
import { placeActivity, resolvedPlace } from "./trip-places.fixture";
import { projectTripWatches } from "./trip-watch";
import type { ActivityItineraryItem } from "./trip";

const z = (minutes: number) => railScheduledInstant("2026-09-13", minutes);
function withActivity(minutes = 700, samePlace = true) {
  const input = impactInput(5, "s2"), rail = input.trip.items[0]!;
  if (rail.type !== "transport" || rail.detail.mode !== "rail" || rail.detail.status !== "selected") throw new Error();
  const journey = rail.detail.journey;
  // This synthetic adoption carries an explicitly resolved station ID. Production TrainIndex names alone do not.
  const destination = { ...rail.detail.journey.legs.at(-1)!.destination, ref: { provider: "timetable", providerPlaceId: "synthetic-station-c" } };
  const resolvedRail = { ...rail, detail: { ...rail.detail, journey: { ...rail.detail.journey,
    legs: journey.legs.map((leg, index) => index === journey.legs.length - 1 ? { ...leg, destination } : leg) } } };
  const activity = { ...placeActivity("visit", samePlace ? destination : resolvedPlace("elsewhere")),
    schedule: { type: "fixed" as const, startAt: z(minutes), endAt: z(minutes + 30) } };
  input.trip = { ...input.trip, items: [resolvedRail, activity] }; return input;
}
function changed(event: TravelEvent, fields: object): TravelEvent {
  const value = { ...event, ...fields } as TravelEvent; return { ...value, id: travelEventId(value) };
}
describe("rail Impact: adopted plan × observed facts", () => {
  it.each([0, 1, 2])("keeps %s minutes with ample transfer margin informational", (delay) => {
    const input = impactInput(delay), before = structuredClone(input), result = evaluateRailTripImpact(input);
    expect(result.status).toBe("no-impact"); expect(result.severity).toBe("informational"); expect(result.policyVersion).toBe(railImpactPolicyVersion);
    expect(result.facts).toContainEqual({ type: "connection-buffer", itemId: "rail", fromLegId: "leg-1", toLegId: "leg-2",
      requiredMinutes: 5, scheduledMinutes: 10, projectedMinutes: 10 - delay, departureBasis: "scheduled" });
    expect(input).toEqual(before);
  });
  it("uses adopted transfer minimum and scheduled next departure, not a delay threshold", () => {
    const risk = evaluateRailTripImpact(impactInput(6));
    expect(risk.severity).toBe("action-required"); expect(risk.reasonCodes).toContain("connection_risk");
    expect(evaluateRailTripImpact(impactInput(3)).severity).toBe("attention");
    expect(evaluateRailTripImpact(impactInput(120, "s2")).severity).toBe("informational");
    expect(risk.facts.find((f) => f.type === "rail-delay")).toMatchObject({ projectedArrivalAt: { at: "2026-09-13T10:06:00.000+09:00" } });
  });
  it("same Place + enough fixed margin is not a risk; other Place without movement is unknown", () => {
    expect(evaluateRailTripImpact(withActivity()).status).toBe("no-impact");
    const other = evaluateRailTripImpact(withActivity(700, false));
    expect(other.status).toBe("unknown"); expect(other.facts).toContainEqual({ type: "uncertainty", itemId: "visit", reason: "movement_missing" });
  });
  it("same name alone never certifies zero ground movement", () => {
    const input = withActivity(); const item = input.trip.items[1] as ActivityItineraryItem;
    input.trip = { ...input.trip, items: [input.trip.items[0]!, { ...item, place: { name: item.place!.name, sources: [] } }] };
    expect(evaluateRailTripImpact(input).status).toBe("unknown");
  });
  it("arrival after fixed start is a definite lower-bound risk even without movement evidence", () => {
    const result = evaluateRailTripImpact(withActivity(642, false));
    expect(result.severity).toBe("action-required"); expect(result.reasonCodes).toContain("appointment_risk");
    expect(result.facts).toContainEqual({ type: "schedule-risk", fromItemId: "rail", toItemId: "visit",
      projectedArrivalAt: { at: "2026-09-13T10:45:00.000+09:00", timeZone: "Asia/Tokyo" }, targetStartAt: z(642), targetBasis: "fixed" });
  });
  it.each([true, false])("window definite conflict=%s; does not pick an implicit placement", (conflict) => {
    const input = withActivity(), item = input.trip.items[1]!;
    input.trip = { ...input.trip, items: [input.trip.items[0]!, { ...item, schedule: { type: "window", earliestStart: z(620), latestEnd: z(conflict ? 660 : 720), durationMinutes: 30 } }] };
    const result = evaluateRailTripImpact(input);
    expect(result.severity).toBe(conflict ? "action-required" : "informational");
    expect(result.status).toBe(conflict ? "impact" : "unknown");
  });
  it.each(["day", "unscheduled"] as const)("does not fabricate fixed %s times", (type) => {
    const input = withActivity(), item = input.trip.items[1]!;
    input.trip = { ...input.trip, items: [input.trip.items[0]!, { ...item, schedule: type === "day" ? { type, date: "2026-09-13" } : { type } }] };
    const before = structuredClone(input.trip); expect(evaluateRailTripImpact(input).status).toBe("unknown"); expect(input.trip).toEqual(before);
  });
  it("does not invent onward arrival through an unobserved service", () => {
    const input = withActivity(); input.event = impactEvent(6); input.watches = projectTripWatches(input.trip).filter((w) => w.subject.type === "rail-service" && w.subject.serviceUid === "s1");
    const result = evaluateRailTripImpact(input);
    expect(result.reasonCodes).toContain("connection_risk"); expect(result.facts).toContainEqual({ type: "uncertainty", itemId: "rail", reason: "onward_arrival" });
  });
  it("explicit cancellation requires observed fresh Evidence and never fabricates critical", () => {
    const input = impactInput(); input.event = impactEvent(0, "s1", { status: "observed", cancelled: true });
    const result = evaluateRailTripImpact(input); expect(result.severity).toBe("action-required"); expect(result.reasonCodes).toContain("rail_cancelled");
    input.event = changed(input.event, { freshness: "stale" }); expect(evaluateRailTripImpact(input).status).toBe("unknown");
  });
  it.each(["B", "C", "Unknown terminal"])("destination name %s is not verified termination identity", (destination) => {
    const input = impactInput(); input.event = impactEvent(0, "s1", { status: "observed", destination });
    const result = evaluateRailTripImpact(input); expect(result.status).toBe("unknown"); expect(result.reasonCodes).toContain("destination_unverified"); expect(result.severity).toBe("informational");
    expect(JSON.stringify(result.facts)).not.toContain(destination === "Unknown terminal" ? destination : "rawProvider");
  });
  it("long-stop alone is informational, not a guessed duration or critical", () => {
    const input = impactInput(); input.event = impactEvent(0, "s1", { status: "observed", longTimeStopping: true });
    const result = evaluateRailTripImpact(input); expect(result.severity).toBe("informational"); expect(result.status).toBe("unknown"); expect(result.facts.some((f) => f.type === "rail-delay")).toBe(false);
  });
  it.each(["unknown", "unavailable"] as const)("%s never becomes 0 delay or cancellation", (status) => {
    const input = impactInput(); input.event = impactEvent(0, "s1", { status, reason: "missing" });
    const result = evaluateRailTripImpact(input); expect(result.status).toBe("unknown"); expect(result.facts.every((f) => f.type === "uncertainty")).toBe(true);
  });
  it("rechecks age, expiry, observed confidence and future data at evaluation, not just a fresh flag", () => {
    for (const fields of [{ freshness: "stale" }, { observedAt: "2026-09-13T00:00:00Z" }, { observedAt: "2026-09-13T02:00:00Z" },
      { sources: [{ ...impactEvent().sources[0]!, confidence: "provider-forecast" }] },
      { sources: [{ ...impactEvent().sources[0]!, validUntil: "2026-09-13T00:59:00Z" }] }]) {
      const input = impactInput(); input.event = changed(input.event, fields); expect(evaluateRailTripImpact(input).status).toBe("unknown");
    }
  });
  it("wrong date/UID/number/number-only or stale Watch is unknown, not no-impact", () => {
    for (const fields of [{ serviceDate: "2026-09-14" }, { serviceUid: "elsewhere" }, { trainNumber: "other" }, { serviceUid: undefined }]) {
      const input = impactInput(); input.event = changed(input.event, { subject: { ...input.event.subject, ...fields } });
      expect(evaluateRailTripImpact(input).status).toBe("unknown");
    }
    const input = impactInput(); input.trip = { ...input.trip, revision: 1 }; expect(evaluateRailTripImpact(input).status).toBe("unknown");
  });
  it("same-service delay preserves midnight/day provenance and never writes the snapshot", () => {
    const input = impactInput(900, "s2"), before = structuredClone(input.trip);
    const result = evaluateRailTripImpact(input); expect(result.facts.find((f) => f.type === "rail-delay")).toMatchObject({ projectedArrivalAt: { at: "2026-09-14T01:40:00.000+09:00" } });
    expect(input.trip).toEqual(before);
  });
  it("same input / reordered watches / evaluation metadata is deterministic", () => {
    const input = impactInput(6), a = evaluateRailTripImpact(input);
    expect(evaluateRailTripImpact({ ...input, watches: [...input.watches].reverse(), evaluatedAt: "2026-09-13T01:01:00Z" }).id).toBe(a.id);
  });
  it("private/unknown measurement fields and notification state are rejected", () => {
    const input = impactInput(), result = evaluateRailTripImpact(input);
    for (const extra of [{ sent: true }, { notificationId: "no" }, { facts: [{ ...result.facts[0], raw: "no" }] }])
      expect(() => validateTripImpact({ ...result, ...extra } as never)).toThrow();
    expect(() => evaluateRailTripImpact({ ...input, reservations: [{ bookingReference: "private" }] as never })).toThrow();
    expect(tripImpactId({ ...result, policyVersion: "other" })).not.toBe(result.id);
  });
});

describe("ReservationFact only", () => {
  const booked = { reservationId: "22222222-2222-4222-8222-222222222222", revision: 0, itineraryItemId: "visit", kind: "activity" as const, status: "booked" as const };
  it.each([640, 700])("booked startsAt %s uses the arrival lower bound", (minutes) => {
    const input = withActivity(); input.reservations = [{ ...booked, startsAt: z(minutes) }];
    const result = evaluateRailTripImpact(input);
    expect(result.severity).toBe(minutes === 640 ? "action-required" : "informational");
    expect(result.facts.some((f) => f.type === "reservation-risk")).toBe(minutes === 640);
  });
  it.each(["booked", "unknown"] as const)("%s without startsAt stays unknown", (status) => {
    const input = withActivity(); input.reservations = [{ ...booked, status }];
    expect(evaluateRailTripImpact(input).status).toBe("unknown");
  });
  it("unknown reservation on the watched rail item is not silently ignored", () => {
    const input = impactInput(0, "s2"); input.reservations = [{ ...booked, kind: "transport", status: "unknown", itineraryItemId: "rail" }];
    expect(evaluateRailTripImpact(input).status).toBe("unknown");
  });
});
