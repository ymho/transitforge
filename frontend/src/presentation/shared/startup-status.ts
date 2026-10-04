/** Outside the hidden product shell, so incomplete startup still has a recovery path. */
export function showStartupFailure(document: Document, reload: () => void): void {
  const status = document.getElementById("startup-status");
  if (!status) return;
  status.hidden = false;
  status.setAttribute("role", "alert");
  status.replaceChildren();
  const message = document.createElement("p");
  message.textContent = "画面を読み込めませんでした。再読み込みしてください。";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = "再読み込み";
  retry.addEventListener("click", reload);
  status.append(message, retry);
  // Hide any half-mounted screen instead of exposing unauthenticated controls.
  const app = document.getElementById("app");
  if (app) app.hidden = true;
}
