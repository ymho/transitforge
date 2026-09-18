import { jsonResponse, type LambdaHttpEvent } from "./contracts/http.js";
import { TripResourceError, tripIdentifier } from "./contracts/trip-api.js";
import { requireTripPrincipal } from "./ports/trip-repository.js";
import type { TripPrincipalResolver } from "./trip-handler.js";
import type { InTripContextApplication } from "./usecases/in-trip-context-application.js";

/** Read-only authenticated host seam. Public deployment remains closed until end-user auth is installed. */
export function createInTripContextHandler(application?: Pick<InTripContextApplication, "read">, authenticate?: TripPrincipalResolver) {
  return async (event: LambdaHttpEvent) => {
    if (!application || !authenticate) return jsonResponse(501, { version: "in-trip-api-v1", error: "unavailable" });
    try {
      const principal = await authenticate(event); requireTripPrincipal(principal);
      if (event.requestContext?.http?.method !== "POST" || !event.body || event.body.length > 512 || event.isBase64Encoded) throw new TripResourceError("invalid-input");
      const v = JSON.parse(event.body);
      if (!v || v.version !== "in-trip-api-v1" || Object.keys(v).some((k) => !["version", "tripId"].includes(k))) throw new TripResourceError("invalid-input");
      tripIdentifier(v.tripId);
      return jsonResponse(200, { version: "in-trip-api-v1", snapshot: await application.read(principal, v.tripId) ?? null });
    } catch (e) {
      const code = e instanceof TripResourceError ? e.code : e instanceof SyntaxError ? "invalid-input" : "unavailable";
      return jsonResponse(code === "unauthenticated" ? 401 : code === "not-found" ? 404 : code === "conflict" ? 409 : code === "unavailable" ? 503 : 400, { version: "in-trip-api-v1", error: code });
    }
  };
}
