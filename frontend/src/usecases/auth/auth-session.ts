/** UI state only. API authority always comes from the server's Access Token verifier. */
export type AuthState =
  | { status: "unavailable" | "signed-out" | "authenticating" | "expired" | "error" }
  | { status: "signed-in"; displayName: string };

export interface AuthSession {
  initialize(): Promise<void>;
  getState(): AuthState;
  subscribe(listener: (state: AuthState) => void): () => void;
  login(): Promise<void>;
  logout(): Promise<void>;
  /** Discard locally rejected/expired credentials without retrying any business request. */
  invalidate(): void;
  /** Only Access Tokens, never ID Tokens. No automatic business request retry. */
  getAccessToken(): Promise<string | undefined>;
}
