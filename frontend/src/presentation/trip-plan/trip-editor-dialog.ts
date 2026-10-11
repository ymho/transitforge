/** The editor lives outside rerendered cards so failed saves retain input and errors. */
export function openTripEditor(form: HTMLFormElement, title: string): void {
  const doc = form.ownerDocument;
  const dialog = doc.createElement("dialog"); dialog.className = "trip-editor-dialog";
  dialog.setAttribute("aria-label", title);
  const heading = doc.createElement("h2"); heading.textContent = title;
  const anchor = doc.createElement("span"); anchor.hidden = true; form.before(anchor);
  dialog.append(heading, form);
  (doc.getElementById("app") ?? doc.body).append(dialog);
  const previous = doc.activeElement as HTMLElement | null;
  const observer = new MutationObserver(() => { if (form.hidden && dialog.open) dialog.close(); });
  dialog.addEventListener("close", () => {
    observer.disconnect(); form.hidden = true;
    if (anchor.isConnected) anchor.replaceWith(form);
    dialog.remove(); if (previous?.isConnected) previous.focus();
  }, { once: true });
  observer.observe(form, { attributes: true, attributeFilter: ["hidden"] });
  form.hidden = false; dialog.showModal();
}
