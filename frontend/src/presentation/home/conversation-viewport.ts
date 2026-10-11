import { iconMarkup } from "../shared/primitives";

/** The message list owns scrolling; this frame anchors the control above the composer. */
export function createConversationViewport(messages: HTMLOListElement): HTMLElement {
  const doc = messages.ownerDocument;
  const viewport = doc.createElement("div");
  viewport.className = "consultation-message-viewport";
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "consultation-scroll-bottom";
  button.setAttribute("aria-label", "会話の最下部へ移動");
  button.title = "会話の最下部へ移動";
  button.innerHTML = iconMarkup("arrowDown");
  button.hidden = true;
  let previousTop = messages.scrollTop;
  messages.addEventListener("scroll", () => {
    const awayFromBottom = messages.scrollHeight - messages.clientHeight - messages.scrollTop > 48;
    if (!awayFromBottom) button.hidden = true;
    else if (messages.scrollTop < previousTop) button.hidden = false;
    previousTop = messages.scrollTop;
  }, { passive: true });
  button.addEventListener("click", () => {
    const reducedMotion = doc.defaultView?.matchMedia("(prefers-reduced-motion: reduce)").matches;
    messages.scrollTo({ top: messages.scrollHeight, behavior: reducedMotion ? "instant" : "smooth" });
  });
  viewport.append(messages, button);
  return viewport;
}
