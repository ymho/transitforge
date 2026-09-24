import type { AuthSession, AuthState } from "../../usecases/auth/auth-session";
import { parseAuthConfig } from "./auth-config";
import { createCognitoSession } from "./cognito-session";

/** Called before loading Viewer modules, so callback parameters cannot reach other adapters. */
export async function createBrowserAuth(): Promise<AuthSession> {
  const href = window.location.href;
  const url = new URL(href);
  const callback = ["code", "state", "error"].some(key => url.searchParams.has(key));
  if (callback) window.history.replaceState(null, "", "/");
  try {
    const response = await fetch("/auth-config.json", { cache: "no-store", credentials: "same-origin", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("Configuration unavailable");
    const config = parseAuthConfig(await response.json(), window.location.origin);
    const auth = createCognitoSession(config, {
      storage: window.sessionStorage,
      location: { href, origin: url.origin, pathname: url.pathname, assign: value => window.location.assign(value) },
      history: window.history, now: () => Date.now(), nonce: () => crypto.randomUUID(),
    });
    await auth.initialize();
    // No hidden renewal; update UI on expiry and after a suspended tab resumes.
    window.setInterval(() => auth.getState(), 1000);
    window.addEventListener("pageshow", () => auth.getState());
    return auth;
  } catch {
    const state: AuthState = { status: callback ? "error" : "unavailable" };
    return {
      initialize: async () => {}, getState: () => state,
      subscribe: listener => { listener(state); return () => {}; },
      login: async () => { window.location.reload(); },
      invalidate: () => {}, logout: async () => {}, refreshAccessToken: async () => undefined, getAccessToken: async () => undefined,
    };
  }
}
