// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { createConversationViewport } from "./conversation-viewport";

function setup(height = 1200) {
  const messages = document.createElement("ol");
  Object.defineProperties(messages, {
    scrollHeight: { value: height, configurable: true },
    clientHeight: { value: 400 },
  });
  const viewport = createConversationViewport(messages);
  const button = viewport.querySelector("button")!;
  const scroll = (top: number) => { messages.scrollTop = top; messages.dispatchEvent(new Event("scroll")); };
  return { messages, viewport, button, scroll };
}

it("shows only after scrolling up, and hides again near the bottom", () => {
  const f = setup();
  expect(f.button.hidden).toBe(true);
  expect(f.button.textContent).toBe("");
  expect(f.button.getAttribute("aria-label")).toBe("会話の最下部へ移動");
  f.scroll(800);
  expect(f.button.hidden).toBe(true);
  f.scroll(600);
  expect(f.button.hidden).toBe(false);
  f.scroll(500);
  expect(f.button.hidden).toBe(false);
  f.scroll(780);
  expect(f.button.hidden).toBe(true);
});

it("does not show for a short conversation or merely growing content", () => {
  const f = setup(300);
  f.scroll(0);
  expect(f.button.hidden).toBe(true);
  Object.defineProperty(f.messages, "scrollHeight", { value: 1200 });
  f.scroll(0);
  expect(f.button.hidden).toBe(true);
});

it.each([false, true])("returns to the bottom respecting reduced motion (%s)", (reducedMotion) => {
  const f = setup();
  vi.spyOn(window, "matchMedia").mockReturnValue({ matches: reducedMotion } as MediaQueryList);
  const scrollTo = vi.spyOn(f.messages, "scrollTo").mockImplementation(() => {});
  f.scroll(800); f.scroll(400);
  f.button.click();
  expect(scrollTo).toHaveBeenCalledWith({ top: 1200, behavior: reducedMotion ? "instant" : "smooth" });
  f.scroll(800);
  expect(f.button.hidden).toBe(true);
  vi.restoreAllMocks();
});
