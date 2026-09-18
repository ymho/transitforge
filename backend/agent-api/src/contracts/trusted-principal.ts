import type { TripPrincipal } from "./trip-principal.js";

/** Server-only verification result. Never deserialize this contract from a request. */
export interface TrustedPrincipal extends TripPrincipal {
  readonly identity: { readonly issuer: string; readonly subject: string };
  readonly scopes: readonly string[];
}

/** Safe categories only: never retain a token, claims or provider error as a cause. */
export class AuthenticationError extends Error {
  constructor(readonly code: "unauthenticated" | "forbidden") { super(code); }
}
