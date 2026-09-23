import { authenticationErrorResponse, httpMethod } from "./adapters/http-api-auth.js";
import { requirePersonalOperation } from "./adapters/api-route-policy.js";
import { randomUUID } from "node:crypto";
import { TripResourceError, tripApiLimits, tripApiVersion } from "./contracts/trip-api.js";
import { jsonResponse, type LambdaContext, type LambdaHttpEvent } from "./contracts/http.js";
import { requireTripPrincipal, type TripPrincipal } from "./ports/trip-repository.js";
import type { TripApplication } from "./usecases/trip-application.js";
import { parsePlanAdoptionCommand } from "./contracts/trip-api.js";
import type { PlanCandidateAdoptionApplication } from "./usecases/plan-candidate-adoption.js";

/** Trusted host injection; production uses createHttpPrincipalResolver, never request identity. */
export type TripPrincipalResolver = (event: LambdaHttpEvent) => Promise<TripPrincipal | undefined>;
export function createTripApiHandler(application?: Pick<TripApplication, "execute"> & { executeAdoption?: PlanCandidateAdoptionApplication["execute"] }, options: {
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
      if (httpMethod(event) !== "POST" || typeof event.body !== "string") throw new TripResourceError("invalid-input");
      // Bound encoded length before allocating decoded bytes as well.
      if (event.body.length > tripApiLimits.bodyBytes * 2) throw new TripResourceError("payload-too-large");
      const body = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
      if (Buffer.byteLength(body, "utf8") > tripApiLimits.bodyBytes) throw new TripResourceError("payload-too-large");
      let value: unknown;
      try { value = JSON.parse(body); } catch { throw new TripResourceError("invalid-input"); }
      requirePersonalOperation("trip", event, value);
      const requested = (value as { operation?: unknown } | null)?.operation;
      if (typeof requested === "string" && ["create", "mutate", "get", "list", "archive", "attach", "detach", "reference", "preview-plan-adoption", "confirm-plan-adoption"].includes(requested)) operation = requested;
      if (requested === "preview-plan-adoption" || requested === "confirm-plan-adoption") {
        if (!application.executeAdoption) throw new TripResourceError("unavailable");
        const command = parsePlanAdoptionCommand(value), { version: _version, confirmationKey, ...request } = command;
        return jsonResponse(200, { version: tripApiVersion, ...await application.executeAdoption(principal, {
          ...request, operation: requested === "preview-plan-adoption" ? "preview" : "confirm",
        }, confirmationKey ? { confirmationKey } : undefined) }, requestId);
      }
      return jsonResponse(200, await application.execute(principal, value), requestId);
    } catch (error) {
      const authError = authenticationErrorResponse(error, tripApiVersion, requestId);
      if (authError) return authError;
      const code = error instanceof TripResourceError ? error.code : "unavailable";
      const status = { unauthenticated: 401, "not-found": 404, "already-exists": 409, conflict: 409, "mutation-reused": 409, "confirmation-required": 409, "feasibility-required": 409, "invalid-input": 400, "payload-too-large": 413, unavailable: 501 }[code];
      options.log?.({ requestId, category: code, operation });
      return jsonResponse(status, { version: tripApiVersion, error: code }, requestId);
    }
  };
}
