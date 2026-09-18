import { authenticationErrorResponse, httpMethod } from "./adapters/http-api-auth.js";
import { requirePersonalOperation } from "./adapters/api-route-policy.js";
import { randomUUID } from "node:crypto";
import { jsonResponse, type LambdaHttpEvent, type LambdaContext } from "./contracts/http.js";
import { TripResourceError } from "./contracts/trip-api.js";
import { sharingVersion } from "./contracts/trip-sharing-api.js";
import type { TripPrincipalResolver } from "./trip-handler.js";
import type { TripSharingApplication } from "./usecases/trip-sharing-application.js";
import { requireTripPrincipal } from "./contracts/trip-principal.js";

/** No headers/body owner or bearer secret acts as authentication. Public default is deliberately gated. */
export function createTripSharingHandler(application?: Pick<TripSharingApplication, "execute">, options: {
  authenticate?: TripPrincipalResolver; log?: (value: { requestId: string; category: string }) => void;
} = {}) {
  return async (event: LambdaHttpEvent, context?: LambdaContext) => {
    const requestId = context?.awsRequestId ?? randomUUID();
    try {
      if (!application || !options.authenticate) throw new TripResourceError("unavailable");
      const principal = await options.authenticate(event); requireTripPrincipal(principal);
      if (event.rawQueryString || Object.keys(event.queryStringParameters ?? {}).length) throw new TripResourceError("invalid-input");
      if (httpMethod(event) !== "POST" || typeof event.body !== "string") throw new TripResourceError("invalid-input");
      if (event.body.length > 16_384) throw new TripResourceError("payload-too-large");
      const body = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
      if (Buffer.byteLength(body) > 8192) throw new TripResourceError("payload-too-large");
      let command: unknown; try { command = JSON.parse(body); } catch { throw new TripResourceError("invalid-input"); }
      requirePersonalOperation("sharing", event, command);
      const response = jsonResponse(200, await application.execute(principal, command), requestId);
      return { ...response, headers: { ...response.headers, "cache-control": "no-store", "referrer-policy": "no-referrer" } };
    } catch (error) {
      const authError = authenticationErrorResponse(error, sharingVersion, requestId);
      if (authError) return authError;
      const code = error instanceof TripResourceError ? error.code : "unavailable";
      options.log?.({ requestId, category: code });
      const status = code === "unauthenticated" ? 401 : code === "not-found" ? 404 : code === "conflict" ? 409 : code === "payload-too-large" ? 413 : code === "invalid-input" ? 400 : 503;
      const response = jsonResponse(!application || !options.authenticate ? 501 : status, { version: sharingVersion, error: code }, requestId);
      return { ...response, headers: { ...response.headers, "cache-control": "no-store", "referrer-policy": "no-referrer" } };
    }
  };
}
