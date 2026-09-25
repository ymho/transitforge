import { describe, expect, it } from "vitest";
import { semanticIntentCorpusExpected } from "./semantic-intent-corpus-expected";
import { semanticIntentCorpusInputs } from "./semantic-intent-corpus-inputs";
import { scoreSemanticInterpretation } from "./semantic-intent-evaluation";

describe("semantic intent gold corpus", () => {
  it("keeps 120 diverse input cases physically separate from gold operations", () => {
    expect(semanticIntentCorpusInputs).toHaveLength(120);
    expect(semanticIntentCorpusExpected).toHaveLength(120);
    expect(new Set(semanticIntentCorpusInputs.map(({ caseId }) => caseId)).size).toBe(120);
    expect(new Set(semanticIntentCorpusExpected.map(({ caseId }) => caseId))).toEqual(new Set(semanticIntentCorpusInputs.map(({ caseId }) => caseId)));
    expect(new Set(semanticIntentCorpusInputs.map(({ category }) => category)).size).toBe(12);
    expect(JSON.stringify(semanticIntentCorpusInputs)).not.toMatch(/allowed|forbiddenTargets|operations|speechAct/);
    expect(new Set(semanticIntentCorpusInputs.map(({ utterance }) => utterance)).size).toBe(120);
  });

  it("accepts one allowed interpretation and rejects forbidden mutation even if another field matches", () => {
    const expected = semanticIntentCorpusExpected.find(({ caseId }) => caseId === "destination-01")!;
    expect(scoreSemanticInterpretation(expected, { outcome: "delta", speechAct: "inform", operations: [{ atomicGroup: 1,
      action: "set", target: "destination", modality: "preferred", precision: "exact", frame: "actual", quote: "出雲大社",
      value: { kind: "place_label", label: "出雲大社" } }], unresolvedFragments: [] })).toMatchObject({ passed: true });
    expect(scoreSemanticInterpretation({ ...expected, forbiddenTargets: ["destination"] }, { outcome: "delta", speechAct: "inform", operations: [{ atomicGroup: 1,
      action: "set", target: "destination", modality: "preferred", precision: "exact", frame: "actual", quote: "出雲大社",
      value: { kind: "place_label", label: "出雲大社" } }], unresolvedFragments: [] })).toMatchObject({ passed: false,
      failures: expect.arrayContaining(["forbidden-target:destination"]) });
  });

  it("distinguishes actual, hypothetical and no-mutation question frames", () => {
    const hypothetical = semanticIntentCorpusExpected.find(({ caseId }) => caseId === "hypothetical-01")!;
    expect(scoreSemanticInterpretation(hypothetical, { outcome: "delta", speechAct: "consider", operations: [{ atomicGroup: 1,
      action: "set", target: "experience", frame: "actual", quote: "雨なら", value: { kind: "text", text: "屋内" } }], unresolvedFragments: [] }).passed).toBe(false);
    const question = semanticIntentCorpusExpected.find(({ caseId }) => caseId === "question-01")!;
    expect(scoreSemanticInterpretation(question, { outcome: "delta", speechAct: "question", operations: [{ atomicGroup: 1,
      action: "set", target: "destination", frame: "actual", quote: "出雲大社", value: { kind: "place_label", label: "出雲大社" } }], unresolvedFragments: [] }))
      .toMatchObject({ passed: false, failures: expect.arrayContaining(["forbidden-target:destination"]) });
  });
});
