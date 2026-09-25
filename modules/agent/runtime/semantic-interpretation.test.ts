import { describe, expect, it } from "vitest";
import { acceptedIntentDeltaFromInterpretation, decodeUtteranceInterpretation } from "./semantic-interpretation";

describe("semantic interpretation", () => {
  it("resolves tomorrow from the trusted turn calendar and keeps its expression", () => {
    const interpretation = decodeUtteranceInterpretation({ outcome: "delta", operations: [{ atomicGroup: 1, action: "set", target: "start_date",
      modality: "required", precision: "exact", frame: "actual", quote: "明日出発", value: { kind: "relative_date", relation: "tomorrow" } }], unresolvedFragments: [] })!;
    const delta = acceptedIntentDeltaFromInterpretation({ interpretation, userRequest: "明日出発します", turnId: "00000000-0000-4000-8000-000000000001", baseIntentRevision: 4, calendarDate: "2026-09-25" })!;
    expect(delta.operations[0]?.value).toEqual({ kind: "local_date", date: "2026-09-26", expression: "tomorrow" });
    expect(delta.operations[0]?.provenance).toEqual({ kind: "user_turn", turnId: "00000000-0000-4000-8000-000000000001", quote: "明日出発" });
  });

  it("keeps 2 nights approximate and 3 nights acceptable as distinct facts", () => {
    const interpretation = decodeUtteranceInterpretation({ outcome: "delta", operations: [
      { atomicGroup: 1, action: "set", target: "duration", modality: "preferred", precision: "approximate", frame: "actual", quote: "2泊くらい", value: { kind: "quantity", amount: 2, unit: "nights" } },
      { atomicGroup: 2, action: "add_alternative", target: "duration", modality: "acceptable", precision: "exact", frame: "actual", quote: "3泊でも大丈夫", value: { kind: "quantity", amount: 3, unit: "nights" } },
    ], unresolvedFragments: [] })!;
    const delta = acceptedIntentDeltaFromInterpretation({ interpretation, userRequest: "2泊くらい、3泊でも大丈夫", turnId: "00000000-0000-4000-8000-000000000001", baseIntentRevision: 0 });
    expect(delta?.operations.map(({ modality, precision, action }) => [modality, precision, action])).toEqual([
      ["preferred", "approximate", "set"], ["acceptable", "exact", "add_alternative"],
    ]);
  });

  it("rejects a fabricated quote and relative dates without a trusted clock", () => {
    const interpretation = decodeUtteranceInterpretation({ outcome: "delta", operations: [{ atomicGroup: 1, action: "set", target: "start_date",
      frame: "actual", quote: "明日", value: { kind: "relative_date", relation: "tomorrow" } }], unresolvedFragments: [] })!;
    expect(() => acceptedIntentDeltaFromInterpretation({ interpretation, userRequest: "来週", turnId: "00000000-0000-4000-8000-000000000001", baseIntentRevision: 0 })).toThrow();
    expect(() => acceptedIntentDeltaFromInterpretation({ interpretation, userRequest: "明日", turnId: "00000000-0000-4000-8000-000000000001", baseIntentRevision: 0 })).toThrow();
  });

  it("does not treat questions or ambiguity as accepted operations", () => {
    expect(decodeUtteranceInterpretation({ outcome: "no_change", operations: [], unresolvedFragments: [] })).toMatchObject({ outcome: "no_change" });
    expect(acceptedIntentDeltaFromInterpretation({ interpretation: { outcome: "ambiguous", operations: [], unresolvedFragments: ["それ"] },
      userRequest: "それで", turnId: "00000000-0000-4000-8000-000000000001", baseIntentRevision: 0 })).toBeUndefined();
  });
});
