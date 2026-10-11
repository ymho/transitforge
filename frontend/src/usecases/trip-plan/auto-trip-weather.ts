import type { Trip } from "@raiquora/trip/trip";
import { tripWeatherBasis, tripWeatherRefreshDue } from "@raiquora/trip/trip-weather";

/** Serialized, screen-triggered refreshes. Server owns the durable attempt limit. */
export function createAutoTripWeather(options: {
  current(): Trip | undefined; identity(): unknown; enabled(): boolean;
  refresh(trip: Trip, itemId: string): Promise<void>; now?(): number;
}) {
  const attempts = new Map<string, number>();
  let running = false, destroyed = false, requested = false;
  const trigger = async () => {
    if (destroyed || !options.enabled()) return;
    if (running) { requested = true; return; }
    const initial = options.current(), identity = options.identity();
    if (!initial) return;
    running = true;
    try {
      for (const item of initial.items) {
        if (destroyed || !options.enabled() || options.identity() !== identity) break;
        const current = options.current(), latest = current?.items.find(value => value.id === item.id);
        if (!current || current.id !== initial.id || !latest) break;
        const now = options.now?.() ?? Date.now(), key = `${current.id}:${latest.id}:${tripWeatherBasis(current, latest)}`;
        if (!tripWeatherRefreshDue(current, latest, now) || now - (attempts.get(key) ?? -Infinity) < 86_400_000) continue;
        attempts.set(key, now);
        try { await options.refresh(current, latest.id); } catch { /* No render loop or repeated requests after a transport failure. */ }
      }
    } finally { running = false; if (requested) { requested = false; void trigger(); } }
  };
  return { trigger, destroy() { destroyed = true; attempts.clear(); } };
}
