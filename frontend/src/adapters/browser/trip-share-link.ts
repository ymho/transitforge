import type { TripShareLink } from "../../usecases/trip-plan/trip-sharing-client";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseTripShareLink(url: string): TripShareLink | undefined {
  try {
    const fragment = new URL(url).hash;
    if (!fragment.startsWith("#trip-share=")) return undefined;
    const parts = fragment.slice(12).split(".");
    if (parts.length !== 3 || !uuid.test(parts[0]!) || !uuid.test(parts[1]!) || !/^[A-Za-z0-9_-]{43}$/.test(parts[2]!)) return undefined;
    return { tripId: parts[0]!, grantId: parts[1]!, secret: parts[2]! };
  } catch { return undefined; }
}
export function makeTripShareLink(origin: string, link: TripShareLink): string {
  const url = new URL(origin); url.search = ""; url.hash = `trip-share=${link.tripId}.${link.grantId}.${link.secret}`;
  if (!parseTripShareLink(url.href)) throw new Error("Invalid share link"); return url.href;
}
/** Consume and scrub before initializing the app. Memory only; authentication failure requires re-opening the link. */
export function consumeTripShareLink(location: Pick<Location, "href">, history: Pick<History, "replaceState">): TripShareLink | undefined {
  const url = new URL(location.href), link = parseTripShareLink(url.href);
  if (url.hash.startsWith("#trip-share=")) { url.hash = ""; history.replaceState(null, "", url.href); }
  return link;
}
