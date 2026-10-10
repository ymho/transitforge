/** Shared modal presentation; proposals and persistence remain owned by the caller. */
export function openTripEditor(form: HTMLFormElement, title: string): void {
  let dialog = form.parentElement instanceof HTMLDialogElement ? form.parentElement : undefined;
  if (!dialog) {
    dialog = form.ownerDocument.createElement("dialog"); dialog.className = "trip-editor-dialog";
    dialog.setAttribute("aria-label", title);
    const heading = form.ownerDocument.createElement("h2"); heading.textContent = title;
    form.before(dialog); dialog.append(heading, form);
    const currentDialog = dialog;
    dialog.addEventListener("close", () => { form.hidden = true; });
    new MutationObserver(() => { if (form.hidden && currentDialog.open) currentDialog.close(); }).observe(form, { attributes: true, attributeFilter: ["hidden"] });
  }
  form.hidden = false;
  if (!dialog.open) dialog.showModal();
}
