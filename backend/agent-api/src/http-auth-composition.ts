import { accessTokenFromHttp } from "./adapters/http-api-auth.js";
import { authenticatedApplication } from "./usecases/authenticated-application.js";
import type { AccessTokenVerifier } from "./ports/access-token-verifier.js";
import type { LambdaHttpEvent } from "./contracts/http.js";
import type { TrustedPrincipal } from "./contracts/trusted-principal.js";

/** Composes HTTP parsing with the existing Application boundary without Adapter -> Usecase imports.
 * Create once per host; reuse verifier/JWKS cache. Scopes are trusted configuration, never request data.
 */
export function createHttpPrincipalResolver(verifier: AccessTokenVerifier, requiredScopes: readonly string[]) {
  const authenticate = authenticatedApplication(verifier, requiredScopes, async (principal: TrustedPrincipal) => principal);
  return async (event: LambdaHttpEvent): Promise<TrustedPrincipal> => authenticate(accessTokenFromHttp(event), undefined);
}
