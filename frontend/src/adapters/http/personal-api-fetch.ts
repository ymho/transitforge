import type { AuthSession } from "../../usecases/auth/auth-session";
import { ApiAuthenticationError } from "../../usecases/auth/api-authentication-error";
import { createAuthenticatedFetch, type PersonalApiFetch } from "./authenticated-fetch";

let installed: ReturnType<typeof createAuthenticatedFetch> | undefined;
let generation = 0;
const listeners = new Set<() => void>();
const changed = () => { generation++; listeners.forEach(listener => listener()); };
/** Installed once by auth composition before personal clients are created. No global fetch patch. */
export function installPersonalApiAuthentication(auth: AuthSession, origin: string) {
  installed?.dispose();
  installed = createAuthenticatedFetch(auth, origin);
  installed.subscribeSessionChange(changed);
  changed();
}
export const personalApiFetch: PersonalApiFetch = Object.assign(
  ((input: RequestInfo | URL, init?: RequestInit) => {
    if (!installed) return Promise.reject(new ApiAuthenticationError("unauthenticated"));
    return installed(input, init);
  }) as typeof fetch,
  { sessionVersion: () => generation,
    subscribeSessionChange(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; } },
);
