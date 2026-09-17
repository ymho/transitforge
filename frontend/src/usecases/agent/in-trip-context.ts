import { buildInTripContext, validateInTripContext, type InTripContextSnapshot, type ContextLocation } from "@raiquora/trip/in-trip-context";
import type { Trip } from "@raiquora/trip/trip";

export interface InTripContextReader { read(tripId: string): Promise<InTripContextSnapshot | undefined>; }
/** Host-supplied read boundary, never a model tool. Failed remote reads remain explicit unknowns. */
export async function loadInTripContext(trip: Trip, now: Date, reader?: InTripContextReader): Promise<InTripContextSnapshot | undefined> {
  if (trip.lifecycleState !== "in_trip") return undefined;
  if (reader) {
    let result: InTripContextSnapshot | undefined, readSucceeded = false;
    try {
      result = await reader.read(trip.id); readSucceeded = true;
    } catch { /* Read failure is not a terminal/empty Trip. Fall back to the saved plan with unknown facts. */ }
    if (readSucceeded && (!result || result.trip.id !== trip.id || result.trip.revision !== trip.revision)) {
      throw new Error("旅程が更新されています。最新の旅程を再取得してください。");
    }
    try {
      if (!result) throw new Error("Read unavailable");
      validateInTripContext(result);
      const age = now.getTime() - Date.parse(result.now.at);
      if (age < -30000 || age > 60000) throw new Error("Stale context");
      return result;
    } catch { /* The plan can still be discussed, but no successful safety/booking read is implied. */ }
  }
  return buildInTripContext(trip, { at: now.toISOString(), timeZone: "UTC" }, { unavailable: ["impacts", "notifications", "reservations"] });
}
/** No automatic geolocation prompt or history. Explicit opt-in host may supply this ephemeral value. */
export function withInTripLocation(snapshot: InTripContextSnapshot, location: ContextLocation): InTripContextSnapshot {
  const value = { ...snapshot, location }; validateInTripContext(value); return structuredClone(value);
}
