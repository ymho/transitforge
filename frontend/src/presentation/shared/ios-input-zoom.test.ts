// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { installIosInputZoomPrevention } from "./ios-input-zoom";

afterEach(() => document.head.replaceChildren());

it("temporarily prevents iOS focus zoom for compact controls and restores the viewport", () => {
  document.head.innerHTML = '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
  const input = document.createElement("input"); input.style.fontSize = "14px"; document.body.append(input);
  installIosInputZoomPrevention(document, { userAgent: "Mozilla/5.0 (iPhone)", platform: "iPhone", maxTouchPoints: 5 });

  input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  expect(document.querySelector<HTMLMetaElement>('meta[name="viewport"]')!.content).toContain("maximum-scale=1");
  input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  expect(document.querySelector<HTMLMetaElement>('meta[name="viewport"]')!.content).toBe("width=device-width, initial-scale=1.0");
  input.remove();
});

it("leaves non-iOS viewports and 16px controls unchanged", () => {
  document.head.innerHTML = '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
  const input = document.createElement("input"); input.style.fontSize = "16px"; document.body.append(input);
  installIosInputZoomPrevention(document, { userAgent: "Mozilla/5.0 (iPhone)", platform: "iPhone", maxTouchPoints: 5 });
  input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  expect(document.querySelector<HTMLMetaElement>('meta[name="viewport"]')!.content).not.toContain("maximum-scale");
  input.remove();
});
