import type { AuthSession } from "../usecases/auth/auth-session";
import { installPersonalApiAuthentication } from "../adapters/http/personal-api-fetch";
import { createBrowserAuth } from "../adapters/auth/browser-auth";
import { mountAuthControls } from "../presentation/auth/auth-controls";

let session: AuthSession | undefined;
export function currentAuthentication(): AuthSession {
  if (!session) throw new Error("Authentication is not initialized");
  return session;
}

export async function startAuthentication() {
  const auth = await createBrowserAuth();
  session = auth;
  installPersonalApiAuthentication(auth, window.location.origin);
  mountAuthControls(document, auth);
  return auth;
}
