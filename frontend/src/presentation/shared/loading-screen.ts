export interface LoadingScreenElements {
  app: HTMLElement;
  screen: HTMLElement;
  message: HTMLElement;
  retry: HTMLButtonElement;
}

export interface LoadingScreenController {
  start(message: string): void;
  setMessage(message: string): void;
  complete(): void;
  fail(message: string): void;
  isComplete(): boolean;
}

const completionDelayMilliseconds = 450;

export function createLoadingScreen(
  elements: LoadingScreenElements,
): LoadingScreenController {
  let complete = elements.screen.hidden;
  let generation = 0;

  return {
    start(message) {
      generation += 1;
      complete = false;
      elements.app.dataset.loadingState = "loading";
      elements.app.setAttribute("aria-busy", "true");
      elements.screen.hidden = false;
      elements.screen.setAttribute("aria-hidden", "false");
      elements.screen.setAttribute("role", "status");
      elements.screen.classList.remove("loading-screen-complete", "loading-screen-error");
      elements.message.textContent = message;
      elements.retry.hidden = true;
    },
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
      const completedGeneration = generation;
      globalThis.setTimeout(() => {
        if (generation === completedGeneration && complete) elements.screen.hidden = true;
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
