import { describe, expect, it } from "vitest";

import { loadViewerElements } from "./viewer-elements";

describe("loadViewerElements", () => {
  it("起動に必要な要素をまとめて返す", () => {
    const element = {} as Element;
    const root = {
      querySelector: () => element,
      querySelectorAll: (selector: string) =>
        selector === "[data-context-view]"
          ? [element, element, element]
          : [element],
    } as unknown as ParentNode;

    const result = loadViewerElements(root);

    expect(result.app).toBe(element);
    expect(result.playbackSpeedButtons).toHaveLength(1);
  });

  it("不足している要素をselector付きで報告する", () => {
    const root = {
      querySelector: (selector: string) => selector === "#map-status" ? null : {},
      querySelectorAll: (selector: string) =>
        selector === "[data-context-view]"
          ? [{}, {}, {}]
          : [{}],
    } as unknown as ParentNode;

    expect(() => loadViewerElements(root)).toThrow("#map-status");
  });
});
