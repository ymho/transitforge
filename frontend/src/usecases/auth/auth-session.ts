/** UI state only. API authority always comes from the server's Access Token verifier. */
export type AuthState =
  | { status: "unavailable" | "signed-out" | "authenticating" | "expired" | "error" }
  | { status: "signed-in"; displayName: string; sessionExpiresAt?: number };

export interface AuthSession {
  initialize(): Promise<void>;
  getState(): AuthState;
  subscribe(listener: (state: AuthState) => void): () => void;
  login(): Promise<void>;
  logout(): Promise<void>;
  /** Discard locally rejected/expired credentials without retrying any business request. */
  invalidate(): void;
  /** Force one refresh after a rejected Access Token. Implementations must single-flight it. */
  refreshAccessToken(rejectedAccessToken?: string): Promise<string | undefined>;
  /** Only Access Tokens, never ID Tokens. Refreshes shortly before expiry. */
  getAccessToken(): Promise<string | undefined>;
}
