import "./auth-controls.css";
import type { AuthSession, AuthState } from "../../usecases/auth/auth-session";

export function mountAuthControls(root: ParentNode, auth: AuthSession): () => void {
  const status = root.querySelector<HTMLElement>("#auth-status")!;
  const login = root.querySelector<HTMLButtonElement>("#auth-login")!;
  const logout = root.querySelector<HTMLButtonElement>("#auth-logout")!;
  const notice = root.querySelector<HTMLElement>("#auth-notice")!;
  const render = (state: AuthState) => {
    status.textContent = state.status === "signed-in" ? state.displayName : {
      unavailable: "ログインはまだ利用できません", "signed-out": "サインインなし",
      authenticating: "認証中…", expired: "ログインの有効期限が切れました。もう一度ログインしてください",
      error: "ログインを完了できませんでした。もう一度お試しください",
    }[state.status];
    notice.hidden = state.status !== "error" && state.status !== "expired";
    notice.textContent = notice.hidden ? "" : status.textContent;
    login.hidden = state.status === "signed-in" || state.status === "unavailable";
    login.disabled = state.status === "authenticating";
    logout.hidden = state.status !== "signed-in";
    for (const label of root.querySelectorAll<HTMLElement>("[data-auth-account-label]")) {
      label.textContent = state.status === "signed-in" ? "ログイン済みユーザー" : "ゲストユーザ";
    }
  };
  const onLogin = () => { void auth.login(); };
  const onLogout = () => { void auth.logout(); };
  login.addEventListener("click", onLogin);
  logout.addEventListener("click", onLogout);
  const unsubscribe = auth.subscribe(render);
  return () => { unsubscribe(); login.removeEventListener("click", onLogin); logout.removeEventListener("click", onLogout); };
}
