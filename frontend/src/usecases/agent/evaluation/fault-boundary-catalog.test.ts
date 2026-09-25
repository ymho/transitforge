import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { faultBoundaryCoverage } from "./fault-boundary-catalog";

const repositoryRoot = fileURLToPath(new URL("../../../../../", import.meta.url));

describe("semantic fault boundary coverage", () => {
  it("indexes twenty distinct allow/reject contracts backed by normal CI tests", () => {
    expect(faultBoundaryCoverage).toHaveLength(20);
    expect(new Set(faultBoundaryCoverage.map(({ id }) => id)).size).toBe(20);
    expect(new Set(faultBoundaryCoverage.map(({ boundary }) => boundary))).toEqual(new Set([
      "authorization", "interpretation", "acceptance", "runtime", "persistence", "delivery",
    ]));
    for (const item of faultBoundaryCoverage) {
      expect(item.invariant).not.toBe(""); expect(item.appliesTo).not.toBe("");
      expect(item.allows).not.toBe(""); expect(item.rejects).not.toBe(""); expect(item.replacement).not.toBe("");
      const source = readFileSync(new URL(item.testFile, `file://${repositoryRoot}`), "utf8");
      expect(source, `${item.id} references a missing test: ${item.testName}`).toContain(JSON.stringify(item.testName));
    }
  });

  it("pairs permissive semantic behavior with rejection at every boundary", () => {
    for (const boundary of new Set(faultBoundaryCoverage.map(({ boundary }) => boundary))) {
      const entries = faultBoundaryCoverage.filter((item) => item.boundary === boundary);
      expect(entries.some(({ allows }) => allows.length > 10), `${boundary} has no allowed behavior`).toBe(true);
      expect(entries.some(({ rejects }) => rejects.length > 10), `${boundary} has no rejected behavior`).toBe(true);
    }
  });
});
