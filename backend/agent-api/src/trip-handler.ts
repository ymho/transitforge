import { randomUUID } from "node:crypto";
import { TripResourceError, tripApiLimits, tripApiVersion } from "./contracts/trip-api.js";
import { jsonResponse, type LambdaContext, type LambdaHttpEvent } from "./contracts/http.js";
import { requireTripPrincipal, type TripPrincipal } from "./ports/trip-repository.js";
import type { TripApplication } from "./usecases/trip-application.js";

/** Composition-owned verifier. No implementation is installed in the current public deployment. */
export type TripPrincipalResolver = (event: LambdaHttpEvent) => Promise<TripPrincipal | undefined>;
export function createTripApiHandler(application?: Pick<TripApplication, "execute">, options: {
  authenticate?: TripPrincipalResolver;
  log?: (fields: { requestId: string; category: string; operation: string }) => void;
} = {}) {
  return async (event: LambdaHttpEvent, context?: LambdaContext) => {
    const requestId = context?.awsRequestId ?? randomUUID();
    let operation = "unknown";
    try {
      if (!application || !options.authenticate) throw new TripResourceError("unavailable");
      const principal = await options.authenticate(event);
      requireTripPrincipal(principal);
      if (event.rawQueryString || Object.keys(event.queryStringParameters ?? {}).length) throw new TripResourceError("invalid-input");
      if (event.requestContext?.http?.method !== "POST" || typeof event.body !== "string") throw new TripResourceError("invalid-input");
      // Bound encoded length before allocating decoded bytes as well.
      if (event.body.length > tripApiLimits.bodyBytes * 2) throw new TripResourceError("payload-too-large");
      const body = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
      if (Buffer.byteLength(body, "utf8") > tripApiLimits.bodyBytes) throw new TripResourceError("payload-too-large");
      let value: unknown;
      try { value = JSON.parse(body); } catch { throw new TripResourceError("invalid-input"); }
      const requested = (value as { operation?: unknown } | null)?.operation;
      if (typeof requested === "string" && ["create", "mutate", "get", "list", "archive", "attach", "detach", "reference"].includes(requested)) operation = requested;
      return jsonResponse(200, await application.execute(principal, value), requestId);
    } catch (error) {
      const code = error instanceof TripResourceError ? error.code : "unavailable";
      const status = { unauthenticated: 401, "not-found": 404, "already-exists": 409, conflict: 409, "mutation-reused": 409, "confirmation-required": 409, "feasibility-required": 409, "invalid-input": 400, "payload-too-large": 413, unavailable: 501 }[code];
      options.log?.({ requestId, category: code, operation });
      return jsonResponse(status, { version: tripApiVersion, error: code }, requestId);
    }
  };
}
