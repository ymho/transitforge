import { expect, it } from "vitest";
import { outputSyntaxDiagnostic } from "./strands-output-syntax.fixture.js";

it("reports missing/empty Evidence reference fields without emitting the model prose or arbitrary keys", () => {
  expect(outputSyntaxDiagnostic({ reply: { kind: "answer", references: [], commentary: "PRIVATE_PROSE" } }))
    .toEqual({ valid: false, kind: "answer", issues: [{ code: "too_small", path: ["reply", "references"] }] });
  const bad = outputSyntaxDiagnostic({ reply: { kind: "conversation", message: "thanks", PRIVATE_KEY: "PRIVATE_VALUE" }, PRIVATE_EXTRA: true });
  expect(JSON.stringify(bad)).not.toContain("PRIVATE");
  expect(bad.valid).toBe(false);
  expect(outputSyntaxDiagnostic({ reply: { kind: "uncertainty", commentary: "PRIVATE_PROSE" } }))
    .toEqual({ valid: true, kind: "uncertainty", issues: [] });
});
