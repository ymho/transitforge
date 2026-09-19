import type { AuthSession } from "../../usecases/auth/auth-session";
import { ApiAuthenticationError } from "../../usecases/auth/api-authentication-error";

const personalPaths = new Set(["/api/agent", "/api/trips/v1", "/api/trips/sharing/v1", "/api/trips/notifications/v1", "/api/trips/in-trip/v1"]);
export type PersonalApiFetch = typeof fetch & {
  sessionVersion(): number;
  subscribeSessionChange(listener: () => void): () => void;
};
export function requestSessionVersion(request: typeof fetch): number {
  return (request as Partial<PersonalApiFetch>).sessionVersion?.() ?? 0;
}
export function subscribeRequestSession(request: typeof fetch, listener: () => void): () => void {
  return (request as Partial<PersonalApiFetch>).subscribeSessionChange?.(listener) ?? (() => {});
}

/** Explicit token boundary for JSON APIs. OAC Agent operations use a dedicated token header. Never wraps streaming or arbitrary external URLs. */
export function createAuthenticatedFetch(auth: AuthSession, origin: string, request: typeof fetch = fetch): PersonalApiFetch & { dispose(): void } {
  let generation = 0;
  const active = new Set<AbortController>(), listeners = new Set<() => void>();
  const changed = () => {
    generation++;
    for (const controller of active) controller.abort();
    for (const listener of listeners) listener();
  };
  const unsubscribe = auth.subscribe(changed);
  const execute: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), origin);
    if (url.origin !== origin || !personalPaths.has(url.pathname) || url.search || url.hash || url.username || url.password) {
      throw new Error("Unsupported personal API destination");
    }
    const base = input instanceof Request ? new Request(input, init) : new Request(url, init);
    if (base.method !== "POST" || (base.headers.has("authorization") || base.headers.has("x-raiquora-access-token"))) throw new Error("Invalid personal API request");
    const epoch = generation;
    const token = await auth.getAccessToken();
    if (epoch !== generation) throw new ApiAuthenticationError("session-changed");
    if (!token || auth.getState().status !== "signed-in") throw new ApiAuthenticationError("unauthenticated");
    if (epoch !== generation) throw new ApiAuthenticationError("session-changed");
    const controller = new AbortController(); active.add(controller);
    const headers = new Headers(base.headers); headers.set(url.pathname === "/api/agent" ? "x-raiquora-access-token" : "authorization", `Bearer ${token}`);
    try {
      const response = await request(new Request(base, {
        headers, signal: AbortSignal.any([base.signal, controller.signal]),
        credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
      }));
      if (epoch !== generation) throw new ApiAuthenticationError("session-changed");
      if (response.status === 401) { auth.invalidate(); throw new ApiAuthenticationError("unauthenticated"); }
      if (response.status === 403) throw new ApiAuthenticationError("forbidden");
      // These bounded JSON APIs are not streams. Buffer before returning so session changes
      // during body consumption cannot publish another account's data to the client.
      const body = await response.arrayBuffer();
      if (auth.getState().status !== "signed-in" || epoch !== generation) throw new ApiAuthenticationError("session-changed");
      const buffered = new Response([204, 205, 304].includes(response.status) ? null : body,
        { status: response.status, statusText: response.statusText, headers: response.headers });
      const readJson = buffered.json.bind(buffered);
      buffered.json = async () => {
        const value: unknown = await readJson();
        if (auth.getState().status !== "signed-in" || epoch !== generation) throw new ApiAuthenticationError("session-changed");
        return value;
      };
      return buffered;
    } catch (error) {
      if (error instanceof ApiAuthenticationError) throw error;
      if (epoch !== generation) throw new ApiAuthenticationError("session-changed");
      throw error; // Network uncertainty is not an auth/business rejection; never auto-retry.
    } finally { active.delete(controller); }
  };
  return Object.assign(execute, {
    sessionVersion: () => generation,
    subscribeSessionChange(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() { unsubscribe(); changed(); listeners.clear(); },
  });
}
