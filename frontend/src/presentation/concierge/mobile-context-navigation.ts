import type { ContextViewKind } from "../../domain/context-workspace";

export interface MobileContextNavigationController {
  open(view: ContextViewKind): boolean;
  close(): void;
  isOpen(): boolean;
}

export function createMobileContextNavigation(options: {
  app: HTMLElement;
  messages: HTMLElement;
  input: HTMLInputElement;
  showContext: (view: ContextViewKind) => boolean;
  afterLayout?: (callback: () => void) => void;
  restoreFocus?: () => boolean;
}): MobileContextNavigationController {
  let conversationScrollTop = 0;
  const afterLayout = options.afterLayout ?? ((callback) =>
    requestAnimationFrame(callback));
  return {
    open(view) {
      if (!options.showContext(view)) return false;
      conversationScrollTop = options.messages.scrollTop;
      options.app.dataset.mobileContextOpen = "true";
      options.app.dataset.mobileContextView = view;
      return true;
    },
    close() {
      delete options.app.dataset.mobileContextOpen;
      delete options.app.dataset.mobileContextView;
      afterLayout(() => {
        options.messages.scrollTop = conversationScrollTop;
        if (options.restoreFocus?.() ?? true) {
          options.input.focus({ preventScroll: true });
        }
      });
    },
    isOpen: () => options.app.dataset.mobileContextOpen === "true",
  };
}
