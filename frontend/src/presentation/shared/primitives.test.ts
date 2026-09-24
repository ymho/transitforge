// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { adoptComposer, createButton, createMediaCarousel, createPageHeading, iconMarkup, pageHeadingMarkup } from "./primitives";

describe("product presentation primitives", () => {
  it("renders fixed SVG icons without navigation glyphs", () => {
    expect(iconMarkup("chat")).toContain("<svg");
    expect(iconMarkup("chat")).toContain('aria-hidden="true"');
    expect(iconMarkup("chat")).not.toContain("✦");
  });

  it("escapes page heading content", () => {
    expect(pageHeadingMarkup("TRIPS", "旅程 <一覧>", "説明")).toContain("旅程 &lt;一覧&gt;");
  });
  it("creates accessible reusable DOM contracts", () => {
    const document = new Document(), form = document.createElement("form"), input = document.createElement("input"), submit = createButton(document, "送る", "primary");
    adoptComposer(form, input, submit); expect(input.className).toContain("ds-control"); expect(form.className).toContain("ds-composer");
    expect(createPageHeading(document, "TRIPS", "旅程").querySelector("h1")?.textContent).toBe("旅程");
    expect(createMediaCarousel(document, [document.createElement("figure")]).getAttribute("aria-label")).toBe("画像一覧");
  });
});
