import { jsonResponse, type LambdaHttpEvent } from "./contracts/http.js";
import { TripResourceError } from "./contracts/trip-api.js";
import { requireTripPrincipal } from "./ports/trip-repository.js";
import type { TripPrincipalResolver } from "./trip-handler.js";
import type { NotificationApplication } from "./usecases/notification-application.js";

/** Same closed-by-default authentication boundary as Trip API. Never takes owner from JSON/header. */
export function createNotificationHandler(application?: Pick<NotificationApplication, "list" | "read">, authenticate?: TripPrincipalResolver) {
  return async (event: LambdaHttpEvent) => {
    try {
      if (!application || !authenticate) return jsonResponse(501, { version: "notification-api-v1", error: "unavailable" });
      const principal = await authenticate(event); requireTripPrincipal(principal);
      if (event.requestContext?.http?.method !== "POST" || !event.body || event.isBase64Encoded || event.body.length > 2048) throw new TripResourceError("invalid-input");
      const v = JSON.parse(event.body) as Record<string, unknown>;
      if (!v || typeof v !== "object" || v.version !== "notification-api-v1") throw new TripResourceError("invalid-input");
      const fields = v.operation === "list" ? ["version", "operation", "after"] : v.operation === "read" ? ["version", "operation", "id", "revision"] : [];
      if (!fields.length || Object.keys(v).some((k) => !fields.includes(k))) throw new TripResourceError("invalid-input");
      const id = (x: unknown) => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
      if (v.operation === "list") {
        if (v.after !== undefined && !id(v.after)) throw new TripResourceError("invalid-input");
        return jsonResponse(200, { version: "notification-api-v1", ...await application.list(principal, v.after as string | undefined) });
      }
      if (!id(v.id) || !Number.isSafeInteger(v.revision) || Number(v.revision) < 0) throw new TripResourceError("invalid-input");
      await application.read(principal, v.id as string, v.revision as number);
      return jsonResponse(200, { version: "notification-api-v1", ok: true });
    } catch (e) {
      const code = e instanceof TripResourceError ? e.code : e instanceof SyntaxError ? "invalid-input" : "unavailable";
      return jsonResponse(code === "unauthenticated" ? 401 : code === "not-found" ? 404 : code === "conflict" ? 409 : code === "unavailable" ? 503 : 400,
        { version: "notification-api-v1", error: code });
    }
  };
}
