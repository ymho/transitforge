export interface LoadingScreenElements {
  app: HTMLElement;
  screen: HTMLElement;
  message: HTMLElement;
  retry: HTMLButtonElement;
}

export interface LoadingScreenController {
  setMessage(message: string): void;
  complete(): void;
  fail(message: string): void;
  isComplete(): boolean;
}

const completionDelayMilliseconds = 450;

export function createLoadingScreen(
  elements: LoadingScreenElements,
): LoadingScreenController {
  let complete = false;

  return {
    setMessage(message) {
      if (!complete) elements.message.textContent = message;
    },
    complete() {
      if (complete) return;
      complete = true;
      elements.app.dataset.loadingState = "ready";
      elements.app.setAttribute("aria-busy", "false");
      elements.screen.setAttribute("aria-hidden", "true");
      elements.screen.classList.add("loading-screen-complete");
      globalThis.setTimeout(() => {
        elements.screen.hidden = true;
      }, completionDelayMilliseconds);
    },
    fail(message) {
      if (complete) return;
      elements.app.dataset.loadingState = "error";
      elements.app.setAttribute("aria-busy", "false");
      elements.screen.setAttribute("role", "alert");
      elements.screen.classList.add("loading-screen-error");
      elements.message.textContent = message;
      elements.retry.hidden = false;
    },
    isComplete() {
      return complete;
    },
  };
}
