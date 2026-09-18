// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { AuthSession, AuthState } from "../../usecases/auth/auth-session";
import { mountAuthControls } from "./auth-controls";

describe("authentication controls", () => {
  it("renders login state safely, dispatches login/logout and explains expiry", () => {
    document.body.innerHTML = '<span data-auth-account-label></span><p id="auth-status"></p><p id="auth-notice"></p><button id="auth-login"></button><button id="auth-logout"></button>';
    let listener!: (state: AuthState) => void;
    const unsubscribe = vi.fn();
    const auth: AuthSession = {
      invalidate: vi.fn(), initialize: vi.fn(), getState: () => ({ status: "signed-out" }),
      subscribe: fn => { listener = fn; fn({ status: "signed-out" }); return unsubscribe; },
      login: vi.fn(), logout: vi.fn(), getAccessToken: async () => undefined,
    };
    const dispose = mountAuthControls(document, auth);
    const login = document.querySelector<HTMLButtonElement>("#auth-login")!;
    const logout = document.querySelector<HTMLButtonElement>("#auth-logout")!;
    login.click(); expect(auth.login).toHaveBeenCalledOnce(); expect(logout.hidden).toBe(true);
    listener({ status: "authenticating" }); expect(login.disabled).toBe(true);
    listener({ status: "signed-in", displayName: '<img src=x onerror="alert(1)">' });
    expect(login.hidden).toBe(true); expect(logout.hidden).toBe(false);
    expect(document.querySelector("#auth-status img")).toBeNull();
    logout.click(); expect(auth.logout).toHaveBeenCalledOnce();
    listener({ status: "expired" });
    expect(login.disabled).toBe(false); expect(login.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>("#auth-notice")!.hidden).toBe(false);
    listener({ status: "unavailable" }); expect(login.hidden).toBe(true);
    dispose(); expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
