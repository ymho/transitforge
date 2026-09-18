import { AuthenticationError, type TrustedPrincipal } from "../contracts/trusted-principal.js";
import type { AccessTokenVerifier } from "../ports/access-token-verifier.js";

/** Bind scopes and business application in trusted composition, never from the request. */
export function authenticatedApplication<Input, Output>(
  verifier: AccessTokenVerifier,
  requiredScopes: readonly string[],
  execute: (principal: TrustedPrincipal, input: Input) => Promise<Output>,
): (accessToken: string | undefined, input: Input) => Promise<Output> {
  if (!requiredScopes.length || requiredScopes.some((scope) => !scope || /\s/.test(scope))) {
    throw new Error("Explicit application scopes are required");
  }
  const scopes = [...requiredScopes];
  return async (accessToken, input) => {
    if (!accessToken) throw new AuthenticationError("unauthenticated");
    const principal = await verifier.verify(accessToken);
    if (!scopes.every((scope) => principal.scopes.includes(scope))) throw new AuthenticationError("forbidden");
    return execute(principal, input);
  };
}
