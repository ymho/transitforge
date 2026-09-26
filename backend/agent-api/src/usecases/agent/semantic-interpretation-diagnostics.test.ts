import { describe, expect, it } from "vitest";
import { parseSemanticInterpretationJson, semanticInterpretationShapeFailure } from "./semantic-interpretation-diagnostics.js";

const valid = {
  outcome: "delta",
  speechAct: "inform",
  operations: [{ atomicGroup: 1, action: "set", target: "origin", frame: "actual", quote: "大阪から",
    value: { kind: "place_label", label: "大阪" } }],
  unresolvedFragments: [],
};

describe("semantic interpretation diagnostics", () => {
  it("classifies root, operation, value and scope failures without content", () => {
    expect(semanticInterpretationShapeFailure({ ...valid, unexpected: true })).toBe("root_shape");
    expect(semanticInterpretationShapeFailure({ ...valid, operations: [{ ...valid.operations[0], action: "invent" }] })).toBe("operation_shape");
    expect(semanticInterpretationShapeFailure({ ...valid, operations: [{ ...valid.operations[0], value: { kind: "place_label", label: "" } }] })).toBe("value_constraint");
    expect(semanticInterpretationShapeFailure({ ...valid, operations: [{ ...valid.operations[0],
      scope: { kind: "logical_day_ordinal", ordinal: 0 } }] })).toBe("scope_shape");
  });

  it("accepts the bounded semantic root shape", () => {
    expect(semanticInterpretationShapeFailure(valid)).toBeUndefined();
  });

  it("accepts only direct JSON or one exact JSON code fence", () => {
    expect(parseSemanticInterpretationJson(JSON.stringify(valid))).toEqual(valid);
    expect(parseSemanticInterpretationJson(`\`\`\`json
${JSON.stringify(valid)}
\`\`\``)).toEqual(valid);
    expect(() => parseSemanticInterpretationJson(`prefix
\`\`\`json
${JSON.stringify(valid)}
\`\`\``)).toThrowError();
    expect(() => parseSemanticInterpretationJson(`\`\`\`json
not-json
\`\`\``)).toThrowError();
  });

  it("separates value kind, field and constraint failures", () => {
    expect(semanticInterpretationShapeFailure({ ...valid, operations: [{ ...valid.operations[0], value: "大阪" }] })).toBe("value_not_object");
    expect(semanticInterpretationShapeFailure({ ...valid, operations: [{ ...valid.operations[0], value: { label: "大阪" } }] })).toBe("value_kind");
    expect(semanticInterpretationShapeFailure({ ...valid, operations: [{ ...valid.operations[0], value: { kind: "place_label", text: "大阪" } }] })).toBe("value_fields");
    expect(semanticInterpretationShapeFailure({ ...valid, operations: [{ ...valid.operations[0], value: { kind: "place_label", label: "" } }] })).toBe("value_constraint");
  });
});
