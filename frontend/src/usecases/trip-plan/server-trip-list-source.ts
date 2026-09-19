import { validateTrip, type Trip } from "@raiquora/trip/trip";
import { ApiAuthenticationError } from "../auth/api-authentication-error";
import type { ServerTripClient } from "./server-trip-client";

export type TripListState = "loading" | "available" | "unavailable" | "unauthenticated";

/** Collects the existing owner-scoped cursor API; this is a read view, never a second Trip cache. */
export function createServerTripListSource(client: Pick<ServerTripClient, "list" | "sessionVersion" | "subscribeSessionChange">,
  authenticated: () => boolean) {
  let state: TripListState = authenticated() ? "loading" : "unauthenticated";
  let trips: Trip[] = [], generation = 0, session = client.sessionVersion?.();
  const listeners = new Set<() => void>();
  const publish = () => listeners.forEach((listener) => listener());
  const sessionChanged = () => {
    const next = client.sessionVersion?.();
    if (next === session && authenticated()) return false;
    session = next; ++generation; trips = []; state = authenticated() ? "loading" : "unauthenticated"; publish(); return true;
  };
  const refresh = async () => {
    sessionChanged();
    if (!authenticated()) { trips = []; state = "unauthenticated"; publish(); return; }
    const request = ++generation, requestSession = session;
    trips = []; state = "loading"; publish();
    try {
      const all: Trip[] = [], seen = new Set<string>(); let afterTripId: string | undefined;
      do {
        const page = await client.list({ limit: 50, ...(afterTripId ? { afterTripId } : {}) });
        if (request !== generation || requestSession !== client.sessionVersion?.() || !authenticated()) return;
        for (const trip of page.trips) {
          validateTrip(trip);
          if (seen.has(trip.id)) throw new Error("Repeated Trip cursor");
          seen.add(trip.id); all.push(trip);
        }
        // The API cursor is the last item of this page, so it is normally already seen.
        if (page.nextAfterTripId !== undefined && page.nextAfterTripId === afterTripId) throw new Error("Invalid Trip cursor");
        afterTripId = page.nextAfterTripId;
      } while (afterTripId);
      if (request !== generation || requestSession !== client.sessionVersion?.() || !authenticated()) return;
      trips = structuredClone(all); state = "available";
    } catch (error) {
      if (request !== generation) return;
      trips = []; state = error instanceof ApiAuthenticationError || !authenticated() ? "unauthenticated" : "unavailable";
    }
    if (request === generation) publish();
  };
  const unsubscribe = client.subscribeSessionChange?.(() => { sessionChanged(); });
  return { getState: () => { sessionChanged(); return state; }, getTrips: () => { sessionChanged(); return structuredClone(trips); }, refresh,
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); }, dispose: () => unsubscribe?.() };
}
