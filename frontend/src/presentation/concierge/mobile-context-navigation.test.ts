import { expect, it, vi } from "vitest";
import { createMobileContextNavigation } from "./mobile-context-navigation";

it("restores the conversation draft viewport after viewing mobile context", () => {
  const app = { dataset: {} } as HTMLElement;
  const messages = { scrollTop: 320 } as HTMLElement;
  const input = { value: "途中まで入力した相談", focus: vi.fn() } as unknown as HTMLInputElement;
  const navigation = createMobileContextNavigation({
    app,
    messages,
    input,
    showContext: () => true,
    afterLayout: (callback) => callback(),
  });

  expect(navigation.open("map")).toBe(true);
  messages.scrollTop = 0;
  navigation.close();
  expect(messages.scrollTop).toBe(320);
  expect(input.value).toBe("途中まで入力した相談");
  expect(input.focus).toHaveBeenCalledWith({ preventScroll: true });
});

it("does not leave chat when the requested context is unavailable", () => {
  const app = { dataset: {} } as HTMLElement;
  const navigation = createMobileContextNavigation({
    app,
    messages: { scrollTop: 0 } as HTMLElement,
    input: { focus: vi.fn() } as unknown as HTMLInputElement,
    showContext: () => false,
    afterLayout: (callback) => callback(),
  });
  expect(navigation.open("trip-plan")).toBe(false);
  expect(navigation.isOpen()).toBe(false);
});
