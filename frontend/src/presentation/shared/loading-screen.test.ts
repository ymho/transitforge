import { afterEach, describe, expect, it, vi } from "vitest";

import { createLoadingScreen } from "./loading-screen";

function elements() {
  const app = {
    dataset: { loadingState: "loading" },
    setAttribute: vi.fn(),
  } as unknown as HTMLElement;
  const screen = {
    classList: { add: vi.fn() },
    hidden: false,
    setAttribute: vi.fn(),
  } as unknown as HTMLElement;
  const message = { textContent: "starting" } as HTMLElement;
  const retry = { hidden: true } as HTMLButtonElement;
  return { app, screen, message, retry };
}

afterEach(() => vi.useRealTimers());

describe("loading screen", () => {
  it("keeps the map loading state until loading completes", () => {
    vi.useFakeTimers();
    const view = elements();
    const loading = createLoadingScreen(view);

    loading.setMessage("列車を読み込んでいます。");
    expect(view.message.textContent).toBe("列車を読み込んでいます。");
    expect(view.app.dataset.loadingState).toBe("loading");

    loading.complete();
    expect(view.app.dataset.loadingState).toBe("ready");
    expect(view.app.setAttribute).toHaveBeenCalledWith("aria-busy", "false");
    expect(view.screen.hidden).toBe(false);

    vi.runAllTimers();
    expect(view.screen.hidden).toBe(true);
    expect(loading.isComplete()).toBe(true);
  });

  it("shows an actionable map loading error", () => {
    const view = elements();
    const loading = createLoadingScreen(view);

    loading.fail("入力を読み込めませんでした。");

    expect(view.app.dataset.loadingState).toBe("error");
    expect(view.message.textContent).toBe("入力を読み込めませんでした。");
    expect(view.retry.hidden).toBe(false);
    expect(view.screen.setAttribute).toHaveBeenCalledWith("role", "alert");
    expect(loading.isComplete()).toBe(false);
  });
});
