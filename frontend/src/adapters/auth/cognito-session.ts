import { OidcClient, WebStorageStateStore } from "oidc-client-ts";
import type { AuthSession, AuthState } from "../../usecases/auth/auth-session";
import { safeReturnPath, type AuthConfig } from "./auth-config";

interface StoredSession {
  version: 1;
  issuer: string;
  clientId: string;
  scopes: string[];
  accessToken: string;
  refreshToken: string;
  issuedAt: number;
  expiresAt: number;
  absoluteExpiresAt: number;
  displayName: string;
}
const accessTokenMaximumSeconds = 300;
const refreshWindowMs = 30_000;
const absoluteSessionMs = 8 * 60 * 60 * 1000;
const clockSkewMs = 30_000;
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
  let refreshFlight: Promise<string | undefined> | undefined;
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
  const fail = () => { clear(); publish({ status: "error" }); };
  const expire = () => { clear(); publish({ status: "expired" }); };
  const signedIn = (value: StoredSession) => publish({ status: "signed-in", displayName: value.displayName, sessionExpiresAt: value.absoluteExpiresAt });
  const persist = (value: StoredSession) => browser.storage.setItem(sessionKey, JSON.stringify(value));
  const refresh = async (rejectedAccessToken?: string): Promise<string | undefined> => {
    if (!session || session.absoluteExpiresAt <= browser.now()) { if (session) expire(); return undefined; }
    if (rejectedAccessToken && session.accessToken !== rejectedAccessToken && session.expiresAt > browser.now()) return session.accessToken;
    if (refreshFlight) return refreshFlight;
    const currentGeneration = generation, refreshToken = session.refreshToken, absoluteExpiresAt = session.absoluteExpiresAt;
    refreshFlight = (async () => {
      try {
        const body = new URLSearchParams({ grant_type: "refresh_token", client_id: config.clientId, refresh_token: refreshToken });
        const response = await fetch(`${config.loginOrigin}/oauth2/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body,
          cache: "no-store", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" });
        const value: unknown = await response.json();
        if (!response.ok || !isRecord(value) || typeof value.access_token !== "string" || !value.access_token ||
            String(value.token_type).toLowerCase() !== "bearer" || !validAccessLifetime(value.expires_in) ||
            (value.refresh_token !== undefined && (typeof value.refresh_token !== "string" || !value.refresh_token)) ||
            (value.scope !== undefined && (typeof value.scope !== "string" || !hasScopes(value.scope, config.scopes)))) throw new Error("Invalid refresh");
        if (currentGeneration !== generation) return undefined;
        if (!session || absoluteExpiresAt <= browser.now()) { expire(); return undefined; }
        const updated: StoredSession = { ...session, accessToken: value.access_token,
          refreshToken: typeof value.refresh_token === "string" ? value.refresh_token : refreshToken,
          expiresAt: Math.min(browser.now() + Number(value.expires_in) * 1000, absoluteExpiresAt) };
        persist(updated); session = updated; return updated.accessToken;
      } catch { if (currentGeneration === generation) expire(); return undefined; }
      finally { refreshFlight = undefined; }
    })();
    return refreshFlight;
  };
  return {
    getState() { if (session && session.absoluteExpiresAt <= browser.now()) expire(); return state; },
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
              !validAccessLifetime(response.expires_in) || typeof response.refresh_token !== "string" || !response.refresh_token ||
              !hasScopes(response.scope ?? "", config.scopes)) throw new Error("Invalid session");
          const issuedAt = browser.now();
          session = {
            version: 1, issuer: config.issuer, clientId: config.clientId, scopes: [...config.scopes],
            accessToken: response.access_token, refreshToken: response.refresh_token, issuedAt,
            expiresAt: issuedAt + response.expires_in * 1000, absoluteExpiresAt: issuedAt + absoluteSessionMs,
            displayName: typeof profile.email === "string" ? profile.email : "ログイン済みユーザー",
          };
          persist(session);
          browser.history.replaceState(null, "", safeReturnPath(response.userState));
          signedIn(session);
        } catch { if (currentGeneration === generation) fail(); }
        return;
      }
      try {
        await oidc.clearStaleState();
        const stored: unknown = JSON.parse(browser.storage.getItem(sessionKey) ?? "null");
        if (validStoredSession(stored, config, browser.now())) {
          session = stored;
          signedIn(stored);
          if (stored.expiresAt <= browser.now() + refreshWindowMs) await refresh();
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
      const revoke = session?.refreshToken;
      clear(); clearPending(); publish({ status: "signed-out" });
      // Cognito logout clears its cookie, not previously issued JWTs.
      if (revoke) { try { await oidc.revokeToken(revoke, "refresh_token"); } catch { /* local logout must still succeed */ } }
      const url = new URL(`${config.loginOrigin}/logout`);
      url.searchParams.set("client_id", config.clientId);
      url.searchParams.set("logout_uri", `${browser.location.origin}/`);
      browser.location.assign(url.href);
    },
    invalidate() { ++generation; clear(); clearPending(); publish({ status: "expired" }); },
    refreshAccessToken(rejectedAccessToken) { return refresh(rejectedAccessToken); },
    async getAccessToken() {
      if (!session || session.absoluteExpiresAt <= browser.now()) { if (session) expire(); return undefined; }
      return session.expiresAt <= browser.now() + refreshWindowMs ? refresh() : session.accessToken;
    },
  };
}

function validAccessLifetime(value: unknown): value is number {
  return Number.isFinite(value) && Number(value) > 0 && Number(value) <= accessTokenMaximumSeconds;
}
function hasScopes(value: string, expected: readonly string[]): boolean {
  const actual = value.split(" ").filter(Boolean); return expected.every(scope => actual.includes(scope));
}
function validStoredSession(value: unknown, config: AuthConfig, now: number): value is StoredSession {
  if (!isRecord(value) || Object.keys(value).some(key => !["version", "issuer", "clientId", "scopes", "accessToken", "refreshToken", "issuedAt", "expiresAt", "absoluteExpiresAt", "displayName"].includes(key)) ||
      value.version !== 1 || value.issuer !== config.issuer || value.clientId !== config.clientId || !Array.isArray(value.scopes) ||
      value.scopes.some(scope => typeof scope !== "string") || !config.scopes.every(scope => (value.scopes as string[]).includes(scope)) ||
      typeof value.accessToken !== "string" || !value.accessToken || typeof value.refreshToken !== "string" || !value.refreshToken || typeof value.displayName !== "string" || !value.displayName ||
      !Number.isFinite(value.issuedAt) || !Number.isFinite(value.expiresAt) || !Number.isFinite(value.absoluteExpiresAt)) return false;
  const issuedAt = Number(value.issuedAt), expiresAt = Number(value.expiresAt), absoluteExpiresAt = Number(value.absoluteExpiresAt);
  return issuedAt <= now + clockSkewMs && absoluteExpiresAt === issuedAt + absoluteSessionMs && absoluteExpiresAt > now &&
    expiresAt > issuedAt && expiresAt <= now + accessTokenMaximumSeconds * 1000 + clockSkewMs && expiresAt <= absoluteExpiresAt;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
