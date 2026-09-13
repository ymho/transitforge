import { validateTrip, type Trip } from "@raiquora/trip/trip";
import type { TripWorkspaceSource } from "./trip-workspace-controller";
import type { ServerTripClient, TripLoadState } from "./server-trip-client";

/** Memory is a fetched read view, never a local writer/cache fallback. Preview cannot save. */
export function createServerTripWorkspaceSource(tripId: string, client: Pick<ServerTripClient, "get">): TripWorkspaceSource & { refresh(): Promise<void> } {
  let current: Trip | undefined, loadState: TripLoadState = "loading", generation = 0;
  const listeners = new Set<() => void>();
  const publish = () => { for (const listener of listeners) listener(); };
  const refresh = async () => {
    const request = ++generation;
    current = undefined; loadState = "loading"; publish();
    try {
      const trip = await client.get(tripId);
      if (request !== generation) return;
      if (!trip || trip.id !== tripId) throw new Error("Trip unavailable");
      validateTrip(trip); current = structuredClone(trip); loadState = "loaded";
    } catch { if (request === generation) { current = undefined; loadState = "unavailable"; } }
    if (request === generation) publish();
  };
  return { sourceState: "server-v2", getLoadState: () => loadState, getCurrentTrip: () => current ? structuredClone(current) : undefined,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, refresh, retry: refresh };
}
