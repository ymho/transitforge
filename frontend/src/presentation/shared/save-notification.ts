import "./save-notification.css";

const active = new WeakMap<Document, () => void>();
const lifetime = 6000;

/** A single completion notice, independent of rerenders and page navigation. */
export function notifySaved(document: Document, message: string): void {
  active.get(document)?.();
  const notice = document.createElement("div"); notice.className = "app-save-notification";
  const text = document.createElement("span"); text.setAttribute("role", "status"); text.textContent = message;
  const ns = "http://www.w3.org/2000/svg";
  const countdown = document.createElementNS(ns, "svg"); countdown.classList.add("app-save-countdown");
  countdown.setAttribute("viewBox", "0 0 24 24"); countdown.setAttribute("aria-hidden", "true");
  for (const kind of ["track", "progress"]) {
    const circle = document.createElementNS(ns, "circle"); circle.classList.add(`app-save-countdown-${kind}`);
    for (const [key, value] of Object.entries({ cx: "12", cy: "12", r: "9", pathLength: "100" })) circle.setAttribute(key, value);
    countdown.append(circle);
  }
  const progress = countdown.lastElementChild as SVGCircleElement;
  let remaining = lifetime, started = Date.now(), hovered = false, focused = false;
  let timer: ReturnType<typeof setTimeout> | undefined, frame: number | undefined;
  const remainingNow = () => timer === undefined ? remaining : Math.max(0, remaining - (Date.now() - started));
  const paint = () => { progress.style.strokeDashoffset = String(100 * remainingNow() / lifetime); };
  const animate = () => { paint(); if (timer !== undefined) frame = document.defaultView?.requestAnimationFrame(animate); };
  const pause = () => {
    remaining = remainingNow(); clearTimeout(timer); timer = undefined;
    if (frame !== undefined) document.defaultView?.cancelAnimationFrame(frame); frame = undefined; paint();
  };
  const observer = new MutationObserver(() => mount());
  const dismiss = () => { pause(); observer.disconnect(); notice.remove(); if (active.get(document) === dismiss) active.delete(document); };
  const resume = () => {
    if (hovered || focused || timer !== undefined) return;
    started = Date.now(); timer = setTimeout(dismiss, remaining); animate();
  };
  notice.addEventListener("mouseenter", () => { hovered = true; pause(); });
  notice.addEventListener("mouseleave", () => { hovered = false; resume(); });
  notice.addEventListener("focusin", () => { focused = true; pause(); });
  notice.addEventListener("focusout", () => { focused = false; resume(); });
  function mount() {
    const host = [...document.querySelectorAll("dialog[open]")].at(-1) ?? document.body;
    if (notice.parentElement !== host) {
      host.append(notice);
      if (typeof notice.showPopover === "function") { notice.setAttribute("popover", "manual"); notice.showPopover(); }
    }
  }
  notice.append(text, countdown); mount();
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
  active.set(document, dismiss); resume();
}
