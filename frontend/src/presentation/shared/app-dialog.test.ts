// @vitest-environment happy-dom
import { beforeEach, expect, it } from "vitest";
import { confirmAction, requestText } from "./app-dialog";
beforeEach(() => { document.body.innerHTML = '<button id="trigger">操作</button>'; document.querySelector<HTMLButtonElement>("button")!.focus(); });
it("waits for explicit acceptance, safely renders text and restores focus", async () => {
  const result = confirmAction(document, '<script>危険</script>を削除しますか？');
  expect(document.querySelector("dialog script")).toBeNull();
  expect(document.querySelector("dialog")!.textContent).toContain('<script>危険</script>');
  document.querySelector<HTMLButtonElement>('dialog button[type=submit]')!.click();
  expect(await result).toBe(true); expect(document.querySelector("dialog")).toBeNull(); expect(document.activeElement?.id).toBe("trigger");
});
it("cancel and Escape reject and duplicate popups cannot approve", async () => {
  const result = confirmAction(document, "削除しますか？");
  expect(await confirmAction(document, "別の操作")).toBe(false);
  document.querySelector("dialog")!.dispatchEvent(new Event("cancel", { cancelable: true }));
  expect(await result).toBe(false);
  const next = confirmAction(document, "もう一度"); document.querySelector<HTMLButtonElement>('dialog button[type=button]')!.click(); expect(await next).toBe(false);
});
it("prefills input, keeps an empty submission open and returns trimmed text", async () => {
  const result = requestText(document, "旅程の名前", "元の名前");
  const input = document.querySelector<HTMLInputElement>("dialog input")!; expect(input.value).toBe("元の名前");
  input.value = " "; document.querySelector<HTMLButtonElement>('dialog button[type=submit]')!.click(); expect(document.querySelector("dialog")).not.toBeNull();
  input.value = " 新しい名前 "; document.querySelector<HTMLButtonElement>('dialog button[type=submit]')!.click(); expect(await result).toBe("新しい名前");
});
