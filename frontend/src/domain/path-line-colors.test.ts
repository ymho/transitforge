import { describe, expect, it } from "vitest";

import { dominantLineColorsByPathId } from "./path-line-colors";

describe("path line colors", () => {
  it("uses the most common known train color for a shared path", () => {
    const colors = dominantLineColorsByPathId(
      [
        { path_id: "path-a", service_uid: "blue-1" },
        { path_id: "path-a", service_uid: "blue-2" },
        { path_id: "path-a", service_uid: "red" },
        { path_id: "path-a", service_uid: "unknown" },
      ],
      new Map([
        ["blue-1", "#007cc3"],
        ["blue-2", "#007cc3"],
        ["red", "#ef3f53"],
        ["unknown", "#a8aaad"],
      ]),
    );

    expect(colors.get("path-a")).toBe("#007cc3");
  });

  it("keeps gray when no train on the path has a known line color", () => {
    const colors = dominantLineColorsByPathId(
      [{ path_id: "path-a", service_uid: "unknown" }],
      new Map([["unknown", "#a8aaad"]]),
    );

    expect(colors.get("path-a")).toBe("#a8aaad");
  });
});
