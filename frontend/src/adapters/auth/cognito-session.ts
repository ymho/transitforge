import { OidcClient, WebStorageStateStore } from "oidc-client-ts";
import type { AuthSession, AuthState } from "../../usecases/auth/auth-session";
import { safeReturnPath, type AuthConfig } from "./auth-config";

interface StoredSession { accessToken: string; expiresAt: number; displayName: string }
export interface AuthBrowser {
  storage: Storage;
  location: Pick<Location, "href" | "origin" | "pathname" | "assign">;
  history: Pick<History, "replaceState">;
  now(): number;
  nonce(): string;
}

export function createCognitoSession(config: AuthConfig, browser: AuthBrowser): AuthSession {
  const redirectUri = `${browser.location.origin}/index.html`;
  const storagePrefix = `raiquora.auth.${config.clientId}.`;
  const sessionKey = `${storagePrefix}session`;
  const oidc = new OidcClient({
    authority: config.issuer, client_id: config.clientId,
    redirect_uri: redirectUri, response_type: "code", response_mode: "query",
    scope: config.scopes.join(" "), loadUserInfo: false,
    filterProtocolClaims: false, staleStateAgeInSeconds: 600,
    requestTimeoutInSeconds: 15,
    stateStore: new WebStorageStateStore({ store: browser.storage, prefix: `${storagePrefix}state.` }),
    metadata: {
      issuer: config.issuer,
      authorization_endpoint: `${config.loginOrigin}/oauth2/authorize`,
      token_endpoint: `${config.loginOrigin}/oauth2/token`,
      revocation_endpoint: `${config.loginOrigin}/oauth2/revoke`,
    },
  });
  let state: AuthState = { status: "signed-out" };
  let session: StoredSession | undefined;
  // Never persisted, used only for best-effort revocation before leaving this document.
  let refreshToken: string | undefined;
  let generation = 0;
  const listeners = new Set<(state: AuthState) => void>();
  const publish = (next: AuthState) => { state = next; listeners.forEach(listener => listener(next)); };
  const clear = () => { session = undefined; browser.storage.removeItem(sessionKey); };
  const clearPending = () => {
    for (let index = browser.storage.length - 1; index >= 0; index--) {
      const key = browser.storage.key(index);
      if (key?.startsWith(`${storagePrefix}state.`)) browser.storage.removeItem(key);
    }
  };
  const fail = () => { clear(); refreshToken = undefined; publish({ status: "error" }); };
  const expire = () => {
    if (session && session.expiresAt <= browser.now()) { clear(); publish({ status: "expired" }); }
  };
  return {
    getState() { expire(); return state; },
    subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
    async initialize() {
      const url = new URL(browser.location.href);
      const callback = ["code", "state", "error"].some(key => url.searchParams.has(key));
      const currentGeneration = ++generation;
      if (callback) {
        // Remove credentials before ANY network request or Viewer initialization.
        browser.history.replaceState(null, "", "/");
        clear();
        publish({ status: "authenticating" });
        try {
          if (`${url.origin}${url.pathname}` !== redirectUri || url.hash ||
              url.searchParams.getAll("state").length !== 1 ||
              (url.searchParams.getAll("code").length !== 1 && !url.searchParams.has("error")) ||
              url.searchParams.getAll("code").length > 1 || url.searchParams.getAll("error").length > 1 ||
              (url.searchParams.has("code") && url.searchParams.has("error"))) throw new Error("Invalid callback");
          const pending = await oidc.readSigninResponseState(url.href);
          if (browser.now() / 1000 - pending.state.created > 600 || pending.state.created > browser.now() / 1000 + 30) {
            clearPending(); throw new Error("Expired login");
          }
          const response = await oidc.processSigninResponse(url.href);
          if (currentGeneration !== generation) return;
          // ID Token is display data from the HTTPS token endpoint, never API authority.
          const profile = response.profile;
          if (!response.id_token || profile.iss !== config.issuer || profile.aud !== config.clientId ||
              typeof profile.exp !== "number" || profile.exp * 1000 <= browser.now() ||
              response.token_type?.toLowerCase() !== "bearer" || !response.access_token ||
              !Number.isFinite(response.expires_in) || !response.expires_in || response.expires_in <= 0 || response.expires_in > 300 ||
              !config.scopes.every(scope => (response.scope ?? "").split(" ").includes(scope))) throw new Error("Invalid session");
          session = {
            accessToken: response.access_token,
            expiresAt: browser.now() + response.expires_in * 1000,
            displayName: typeof profile.email === "string" ? profile.email : "ログイン済みユーザー",
          };
          refreshToken = response.refresh_token;
          browser.storage.setItem(sessionKey, JSON.stringify(session));
          browser.history.replaceState(null, "", safeReturnPath(response.userState));
          publish({ status: "signed-in", displayName: session.displayName });
        } catch { if (currentGeneration === generation) fail(); }
        return;
      }
      try {
        await oidc.clearStaleState();
        const stored = JSON.parse(browser.storage.getItem(sessionKey) ?? "null") as StoredSession | null;
        if (stored && typeof stored.accessToken === "string" && stored.accessToken.length > 0 &&
            typeof stored.displayName === "string" && Number.isFinite(stored.expiresAt) &&
            stored.expiresAt <= browser.now() + 300_000) {
          session = stored;
          publish({ status: "signed-in", displayName: stored.displayName });
          expire();
        } else clear();
      } catch { fail(); }
    },
    async login() {
      ++generation;
      clear(); clearPending();
      publish({ status: "authenticating" });
      try {
        const request = await oidc.createSigninRequest({
          state: safeReturnPath(browser.location.pathname), nonce: browser.nonce(),
          extraQueryParams: { lang: "ja" },
        });
        browser.location.assign(request.url);
      } catch { fail(); }
    },
    async logout() {
      ++generation;
      const revoke = refreshToken;
      refreshToken = undefined;
      clear(); clearPending(); publish({ status: "signed-out" });
      // Cognito logout clears its cookie, not previously issued JWTs.
      if (revoke) { try { await oidc.revokeToken(revoke, "refresh_token"); } catch { /* local logout must still succeed */ } }
      const url = new URL(`${config.loginOrigin}/logout`);
      url.searchParams.set("client_id", config.clientId);
      url.searchParams.set("logout_uri", `${browser.location.origin}/`);
      browser.location.assign(url.href);
    },
    async getAccessToken() { expire(); return session?.accessToken; },
  };
}
