import "./save-notification.css";

const active = new WeakMap<Document, () => void>();

/** A single completion notice, independent of rerenders and page navigation. */
export function notifySaved(document: Document, message: string): void {
  active.get(document)?.();
  const notice = document.createElement("div"); notice.className = "app-save-notification";
  const text = document.createElement("span"); text.setAttribute("role", "status"); text.textContent = message;
  const close = document.createElement("button"); close.type = "button"; close.textContent = "×"; close.setAttribute("aria-label", "通知を閉じる");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pause = () => { clearTimeout(timer); };
  const dismiss = () => { pause(); notice.remove(); if (active.get(document) === dismiss) active.delete(document); };
  const resume = () => { pause(); timer = setTimeout(dismiss, 6000); };
  close.addEventListener("click", dismiss);
  notice.addEventListener("mouseenter", pause); notice.addEventListener("mouseleave", resume);
  notice.addEventListener("focusin", pause); notice.addEventListener("focusout", resume);
  notice.append(text, close); document.body.append(notice);
  // Popovers remain visible above an open editor or sharing dialog without taking focus.
  if (typeof notice.showPopover === "function") { notice.setAttribute("popover", "manual"); notice.showPopover(); }
  active.set(document, dismiss); resume();
}
