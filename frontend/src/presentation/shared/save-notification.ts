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
  const observer = new MutationObserver(() => mount());
  const dismiss = () => { pause(); observer.disconnect(); notice.remove(); if (active.get(document) === dismiss) active.delete(document); };
  const resume = () => { pause(); timer = setTimeout(dismiss, 6000); };
  close.addEventListener("click", dismiss);
  notice.addEventListener("mouseenter", pause); notice.addEventListener("mouseleave", resume);
  notice.addEventListener("focusin", pause); notice.addEventListener("focusout", resume);
  function mount() {
    // Modal descendants stay interactive; moving out when it closes preserves the notice.
    const host = [...document.querySelectorAll("dialog[open]")].at(-1) ?? document.body;
    if (notice.parentElement !== host) {
      host.append(notice);
      if (typeof notice.showPopover === "function") { notice.setAttribute("popover", "manual"); notice.showPopover(); }
    }
  }
  notice.append(text, close); mount();
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
  active.set(document, dismiss); resume();
}
