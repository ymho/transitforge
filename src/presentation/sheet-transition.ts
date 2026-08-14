const sheetExitDurationMilliseconds = 220;

export function showSheet(element: HTMLElement): void {
  delete element.dataset.sheetState;
  element.hidden = false;
}

export function hideSheet(
  element: HTMLElement,
  afterHide?: () => void,
): void {
  if (element.hidden) {
    afterHide?.();
    return;
  }

  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    element.hidden = true;
    delete element.dataset.sheetState;
    afterHide?.();
    return;
  }

  element.dataset.sheetState = "closing";
  const finish = () => {
    if (element.dataset.sheetState !== "closing") {
      return;
    }
    element.hidden = true;
    delete element.dataset.sheetState;
    afterHide?.();
  };
  element.addEventListener("animationend", finish, { once: true });
  window.setTimeout(finish, sheetExitDurationMilliseconds + 80);
}
