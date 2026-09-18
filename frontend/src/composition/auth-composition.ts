import { installPersonalApiAuthentication } from "../adapters/http/personal-api-fetch";
import { createBrowserAuth } from "../adapters/auth/browser-auth";
import { mountAuthControls } from "../presentation/auth/auth-controls";

export async function startAuthentication() {
  const auth = await createBrowserAuth();
  installPersonalApiAuthentication(auth, window.location.origin);
  mountAuthControls(document, auth);
  return auth;
}
