import { TripResourceError } from "./trip-api.js";

/** Established by trusted server authentication/storage, never a public request body. */
export interface TripPrincipal { readonly subject: string }
export function requireTripPrincipal(principal: TripPrincipal | undefined): asserts principal is TripPrincipal {
  if (!principal || typeof principal.subject !== "string" || !principal.subject.trim() || principal.subject.length > 200 || /[\u0000-\u001f\u007f]/.test(principal.subject)) throw new TripResourceError("unauthenticated");
}
