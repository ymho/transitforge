import type { TrustedPrincipal } from "../contracts/trusted-principal.js";

/** Trusted composition supplies this port; request data can only supply the token. */
export interface AccessTokenVerifier {
  verify(accessToken: string): Promise<TrustedPrincipal>;
}
