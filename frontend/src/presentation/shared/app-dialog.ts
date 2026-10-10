/** Application-owned confirmation/input popup; no browser confirm/prompt fallback. */
export function appDialog(doc: Document, message: string, options: { value?: string; confirmLabel?: string } = {}): Promise<string | boolean> {
  const active = doc.querySelector<HTMLDialogElement>("dialog.app-dialog");
  if (active) return Promise.resolve(false);
  const previous = doc.activeElement as HTMLElement | null;
  const dialog = doc.createElement("dialog"); dialog.className = "app-dialog";
  const title = doc.createElement("h2"); title.id = "app-dialog-title"; title.textContent = options.value === undefined ? "確認" : message;
  dialog.setAttribute("aria-labelledby", title.id);
  const form = doc.createElement("form"); form.method = "dialog";
  const copy = doc.createElement("p"); copy.textContent = message; copy.id = "app-dialog-description";
  dialog.setAttribute("aria-describedby", copy.id);
  let input: HTMLInputElement | undefined;
  if (options.value !== undefined) { input = doc.createElement("input"); input.className = "ds-control"; input.value = options.value; input.maxLength = 240; input.setAttribute("aria-label", message); }
  const actions = doc.createElement("div"); actions.className = "app-dialog-actions";
  const cancel = doc.createElement("button"); cancel.type = "button"; cancel.className = "ds-button"; cancel.textContent = "取消";
  const accept = doc.createElement("button"); accept.type = "submit"; accept.className = "ds-button ds-button--primary"; accept.textContent = options.confirmLabel ?? (input ? "保存" : "確定");
  actions.append(cancel, accept); form.append(title, copy); if (input) form.append(input); form.append(actions); dialog.append(form); (doc.getElementById("app") ?? doc.body).append(dialog);
  return new Promise(resolve => {
    let done = false;
    const finish = (value: string | boolean) => { if (done) return; done = true; dialog.close(); dialog.remove(); if (previous?.isConnected) previous.focus(); resolve(value); };
    cancel.addEventListener("click", () => finish(false));
    dialog.addEventListener("cancel", event => { event.preventDefault(); finish(false); });
    dialog.addEventListener("click", event => { if (event.target === dialog) { const box = dialog.getBoundingClientRect(); const e = event as MouseEvent; if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) finish(false); } });
    form.addEventListener("submit", event => { event.preventDefault(); if (input && !input.value.trim()) { input.focus(); return; } finish(input ? input.value.trim() : true); });
    dialog.showModal(); (input ?? cancel).focus(); input?.select();
  });
}
export async function confirmAction(doc: Document, message: string): Promise<boolean> { return await appDialog(doc, message) === true; }
export async function requestText(doc: Document, message: string, value: string): Promise<string | undefined> { const result = await appDialog(doc, message, { value }); return typeof result === "string" ? result : undefined; }
