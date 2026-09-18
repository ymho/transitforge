// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { createBrowserAuth } from "./browser-auth";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
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
