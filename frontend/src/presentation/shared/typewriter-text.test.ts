// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { typewriteText } from "./typewriter-text";
import { renderAssistantMarkdown } from "../concierge/assistant-markdown";

let frames: Map<number, FrameRequestCallback>;
let sequence: number;
beforeEach(() => {
  frames = new Map(); sequence = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.spyOn(window, "matchMedia").mockReturnValue({ matches: false } as MediaQueryList);
});
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function step() {
  const callbacks = [...frames.values()]; frames.clear();
  callbacks.forEach((callback) => callback(0));
}
function mount(markdown: string) {
  const element = document.createElement("div");
  element.append(renderAssistantMarkdown(markdown)); document.body.append(element);
  return element;
}
describe("typewriter reading order", () => {
  it("does not reveal ordered or nested list markers before their text", () => {
    const element = mount("前文\n\n1. 一番\n   - 内側\n2. 二番");
    const items = [...element.querySelectorAll("li")];
    const cancel = typewriteText(element, { maximumDurationMs: 99999 });
    expect(items.every((item) => item.style.display === "none")).toBe(true);
    step(); step(); // 前文
    expect(items.every((item) => item.style.display === "none")).toBe(true);
    step(); // 一
    expect(items[0]!.style.display).toBe("");
    expect(items[0]!.textContent).toBe("一");
    expect(items.slice(1).every((item) => item.style.display === "none")).toBe(true);
    cancel();
    expect(items.every((item) => item.style.display === "")).toBe(true);
    expect(element.textContent).toContain("二番");
  });

  it("reveals headings links and table cells in order without rebuilding safe DOM", () => {
    const element = mount("# 見出し\n\n[公式](https://example.com)\n\n| 駅 | 時刻 |\n| --- | --- |\n| 京都 | 9時 |");
    const link = element.querySelector("a")!;
    typewriteText(element, { maximumDurationMs: 99999 });
    expect(link.style.display).toBe("none");
    expect(element.querySelector("table")!.style.display).toBe("none");
    for (let i = 0; i < 100 && frames.size; i++) step();
    expect(element.querySelector("a")).toBe(link);
    expect(link.href).toBe("https://example.com/");
    expect(element.textContent).toContain("京都");
    expect(element.querySelector("table")!.style.display).toBe("");
    expect(frames.size).toBe(0);
  });

  it("restores original inline styles and Unicode on cancellation or detachment", () => {
    const element = mount("- 🌊旅");
    const item = element.querySelector("li")!;
    item.style.setProperty("display", "list-item", "important");
    typewriteText(element, { maximumDurationMs: 99999 }); step();
    expect(item.textContent).toBe("🌊");
    element.remove(); step();
    expect(item.textContent).toBe("🌊旅");
    expect(item.style.getPropertyValue("display")).toBe("list-item");
    expect(item.style.getPropertyPriority("display")).toBe("important");
    expect(frames.size).toBe(0);
  });

  it("shows full content immediately with reduced motion", () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
    const element = mount("- 全文"); typewriteText(element);
    expect(element.textContent).toBe("全文");
    expect(element.querySelector("li")!.style.display).toBe("");
    expect(frames.size).toBe(0);
  });

  it("replaces an earlier animation and ignores its stale cancellation", () => {
    const element = mount("- 文字列");
    const cancelOld = typewriteText(element);
    const cancelNew = typewriteText(element);
    cancelOld();
    expect(element.textContent).toBe("");
    cancelNew();
    expect(element.textContent).toBe("文字列");
    expect(frames.size).toBe(0);
  });
});
