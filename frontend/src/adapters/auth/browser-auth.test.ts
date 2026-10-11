// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { createBrowserAuth } from "./browser-auth";
import { webcrypto } from "node:crypto";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it("cleans callback before config fetch and handles missing configuration without starting OAuth", async () => {
  window.history.replaceState(null, "", "/index.html?code=sensitive&state=sensitive");
  vi.stubGlobal("fetch", vi.fn(async () => {
    expect(window.location.search).toBe("");
    return new Response("missing", { status: 404 });
  }));
  const auth = await createBrowserAuth();
  expect(auth.getState().status).toBe("error");
  expect(await auth.getAccessToken()).toBeUndefined();
  const reload = vi.spyOn(window.location, "reload").mockImplementation(() => {});
  await auth.login();
  expect(reload).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledWith("/auth-config.json", expect.objectContaining({ cache: "no-store", referrerPolicy: "no-referrer" }));
});
it("leaves development Viewer usable when configuration is unavailable", async () => {
  window.history.replaceState(null, "", "/");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  const auth = await createBrowserAuth(); expect(auth.getState().status).toBe("unavailable");
});
it("enables passive provider restoration before the top page is composed", async () => {
  sessionStorage.clear(); window.history.replaceState(null, "", "/");
  vi.stubGlobal("crypto", webcrypto);
  const origin = window.location.origin;
  const config = { issuer: "https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_fixture",
    clientId: "browserfixture", loginOrigin: "https://browser.auth.ap-northeast-1.amazoncognito.com",
    scopes: ["openid", "email", "raiquora/user"], callbackUrls: [`${origin}/index.html`], logoutUrls: [`${origin}/`] };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(config))));
  vi.useFakeTimers();
  const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
  const auth = await createBrowserAuth();
  expect(auth.getState().status).toBe("authenticating");
  expect(new URL(assign.mock.calls[0]![0]).searchParams.get("prompt")).toBe("none");
  sessionStorage.clear();
});
