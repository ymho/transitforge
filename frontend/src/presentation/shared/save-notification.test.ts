// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { notifySaved } from "./save-notification";

afterEach(() => { document.querySelector<HTMLButtonElement>(".app-save-notification button")?.click(); vi.useRealTimers(); document.body.replaceChildren(); });

it("replaces the previous notice and restarts expiry; close dismisses immediately", () => {
  vi.useFakeTimers(); notifySaved(document, "保存しました。"); vi.advanceTimersByTime(5000);
  notifySaved(document, "削除しました。");
  expect(document.querySelectorAll(".app-save-notification")).toHaveLength(1);
  vi.advanceTimersByTime(5000); expect(document.querySelector('[role="status"]')?.textContent).toBe("削除しました。");
  document.querySelector<HTMLButtonElement>('.app-save-notification button')!.click();
  expect(document.querySelector(".app-save-notification")).toBeNull();
  notifySaved(document, "保存しました。"); vi.advanceTimersByTime(6000);
  expect(document.querySelector(".app-save-notification")).toBeNull();
});

it("keeps a notice while hovered or focused and renders messages as plain text", () => {
  vi.useFakeTimers(); notifySaved(document, "<img src=x>");
  const notice = document.querySelector<HTMLElement>(".app-save-notification")!;
  expect(notice.querySelector("img")).toBeNull();
  notice.dispatchEvent(new Event("mouseenter")); vi.advanceTimersByTime(10000); expect(notice.isConnected).toBe(true);
  notice.dispatchEvent(new Event("mouseleave")); notice.dispatchEvent(new Event("focusin"));
  vi.advanceTimersByTime(10000); expect(notice.isConnected).toBe(true);
  notice.dispatchEvent(new Event("focusout")); vi.advanceTimersByTime(6000); expect(notice.isConnected).toBe(false);
});

it("keeps the close control within a modal and moves the notice out when it closes", async () => {
  vi.useFakeTimers(); const dialog = document.createElement("dialog"); dialog.setAttribute("open", ""); document.body.append(dialog);
  notifySaved(document, "共有設定を更新しました。");
  const notice = document.querySelector(".app-save-notification")!; expect(notice.parentElement).toBe(dialog);
  dialog.removeAttribute("open"); await Promise.resolve(); await Promise.resolve();
  expect(notice.parentElement).toBe(document.body);
});
