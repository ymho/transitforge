import { railTravelEvent } from "./travel-event-projection";
import { railSelectionFixture } from "./selected-rail-journey.fixture";
import { travelEventId, type TravelEvent, type RailEventFact } from "./travel-event";
import { watchTrip } from "./trip-watch.fixture";
import { projectTripWatches } from "./trip-watch";
import type { RailTripImpactInput } from "./rail-trip-impact";

export const impactNow = "2026-09-13T01:00:00Z";
export function impactEvent(delay = 0, uid = "s1", fact?: RailEventFact): TravelEvent {
  const number = uid === "s1" ? "1M" : "2M";
  const base = railTravelEvent({ type: "rail-service", serviceDate: "2026-09-13", serviceUid: uid, trainNumber: number },
    railSelectionFixture().inputs[0]!.index, { collectedAt: impactNow, failedSources: [], operationsByTrainNumber: new Map([
      [number, { delayMinutes: delay, destination: "", sources: ["synthetic"] }],
    ]) }, [{ id: "operation", kind: "event", provider: "synthetic", sourceId: "synthetic-operation", retrievedAt: impactNow, confidence: "observed" }], impactNow);
  const event = { ...base, ...(fact ? { fact } : {}) } as TravelEvent;
  return { ...event, id: travelEventId(event) };
}
export function impactInput(delay = 0, uid = "s1"): RailTripImpactInput {
  const trip = watchTrip(), event = impactEvent(delay, uid);
  return { trip, event, watches: projectTripWatches(trip).filter((w) => w.subject.type === "rail-service" && w.subject.serviceUid === uid),
    reservations: [], evaluatedAt: impactNow };
}
