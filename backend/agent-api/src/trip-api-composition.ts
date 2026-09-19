import { createCognitoAccessTokenVerifier } from "./adapters/cognito-access-token-verifier.js";
import { createHttpPrincipalResolver } from "./http-auth-composition.js";
import { createAuthorizedTripApplications } from "./trip-composition-root.js";
import { createTripApiHandler } from "./trip-handler.js";
import { jsonResponse, type LambdaContext, type LambdaHttpEvent } from "./contracts/http.js";
import type { AccessTokenVerifier } from "./ports/access-token-verifier.js";

/** Dedicated public host for the owner-scoped Trip writer. It exposes no sharing or worker routes. */
export function createTripApiPublicHandler(options: {
  enabled: boolean;
  auth: { userPoolId: string; clientId: string; requiredScopes: readonly string[] };
  tripTable: string;
  verifier?: AccessTokenVerifier;
}) {
  if (!options.enabled) return async (_event: LambdaHttpEvent, _context?: LambdaContext) => jsonResponse(503, { error: "unavailable" });
  if (!options.tripTable) throw new Error("Missing Trip API configuration");
  const authenticate = createHttpPrincipalResolver(options.verifier ?? createCognitoAccessTokenVerifier(options.auth), options.auth.requiredScopes);
  const handler = createTripApiHandler(createAuthorizedTripApplications(options.tripTable).trips, { authenticate });
  return (event: LambdaHttpEvent, context?: LambdaContext) => {
    if (event.rawPath && event.path && event.rawPath !== event.path) return Promise.resolve(jsonResponse(404, { error: "not-found" }));
    return (event.rawPath ?? event.path) === "/api/trips/v1"
      ? handler(event, context)
      : Promise.resolve(jsonResponse(404, { error: "not-found" }));
  };
}
