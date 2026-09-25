const editableSelector = "input, textarea, select";

/**
 * iOS Safari zooms the page when a control whose text is smaller than 16px gains focus.
 * Temporarily cap only that focused viewport, preserving the product's compact type and
 * restoring the original viewport as soon as the user leaves the control.
 */
export function installIosInputZoomPrevention(
  document: Document,
  navigator: Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints">,
): () => void {
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!isIos || !viewport) return () => {};

  const original = viewport.content;
  const restrict = (target: EventTarget | null) => {
    const control = target instanceof HTMLElement ? target.closest<HTMLElement>(editableSelector) : null;
    if (!control || Number.parseFloat(document.defaultView?.getComputedStyle(control).fontSize ?? "16") >= 16) return;
    const withoutMaximum = original.split(",").map((part) => part.trim()).filter((part) => !part.startsWith("maximum-scale=")).join(", ");
    viewport.content = `${withoutMaximum}, maximum-scale=1`;
  };
  const restore = () => { viewport.content = original; };
  const onFocusIn = (event: FocusEvent) => restrict(event.target);
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", restore);
  return () => {
    document.removeEventListener("focusin", onFocusIn);
    document.removeEventListener("focusout", restore);
    restore();
  };
}
