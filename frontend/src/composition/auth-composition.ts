import { createBrowserAuth } from "../adapters/auth/browser-auth";
import { mountAuthControls } from "../presentation/auth/auth-controls";

export async function startAuthentication() {
  const auth = await createBrowserAuth();
  mountAuthControls(document, auth);
  return auth;
}
