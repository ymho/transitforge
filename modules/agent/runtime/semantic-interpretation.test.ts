import { describe, expect, it } from "vitest";
import { acceptedIntentDeltaFromInterpretation, decodeUtteranceInterpretation } from "./semantic-interpretation";

describe("semantic interpretation", () => {
  it("resolves tomorrow from the trusted turn calendar and keeps its expression", () => {
    const interpretation = decodeUtteranceInterpretation({ outcome: "delta", speechAct: "inform", operations: [{ atomicGroup: 1, action: "set", target: "start_date",
      modality: "required", precision: "exact", frame: "actual", quote: "明日出発", value: { kind: "relative_date", relation: "tomorrow" } }], unresolvedFragments: [] })!;
    const delta = acceptedIntentDeltaFromInterpretation({ interpretation, userRequest: "明日出発します", turnId: "00000000-0000-4000-8000-000000000001", baseIntentRevision: 4, calendarDate: "2026-09-25" })!;
    expect(delta.operations[0]?.value).toEqual({ kind: "local_date", date: "2026-09-26", expression: "tomorrow",
      anchorDate: "2026-09-25", resolverVersion: "calendar-v1" });
    expect(delta.operations[0]?.provenance).toEqual({ kind: "user_turn", turnId: "00000000-0000-4000-8000-000000000001", quote: "明日出発" });
  });

  it("resolves month precision and relative weekdays without inventing a day", () => {
    const interpretation = decodeUtteranceInterpretation({ outcome: "delta", speechAct: "inform", operations: [
      { atomicGroup: 1, action: "set", target: "start_date", precision: "qualitative", frame: "actual", quote: "来月",
        value: { kind: "month_offset", offset: 1 } },
      { atomicGroup: 2, action: "set", target: "end_date", precision: "exact", frame: "actual", quote: "次の月曜",
        value: { kind: "relative_weekday", weekday: 1, direction: "next" } },
    ], unresolvedFragments: [] })!;
    const delta = acceptedIntentDeltaFromInterpretation({ interpretation, userRequest: "来月、次の月曜まで", turnId: "00000000-0000-4000-8000-000000000002",
      baseIntentRevision: 0, calendarDate: "2026-09-25" })!;
    expect(delta.operations.map(({ value }) => value)).toEqual([
      { kind: "local_month", month: "2026-10", expression: "month_offset", anchorDate: "2026-09-25", resolverVersion: "calendar-v1" },
      { kind: "local_date", date: "2026-09-28", expression: "relative_weekday", anchorDate: "2026-09-25", resolverVersion: "calendar-v1" },
    ]);
  });

  it("keeps 2 nights approximate and 3 nights acceptable as distinct facts", () => {
    const interpretation = decodeUtteranceInterpretation({ outcome: "delta", speechAct: "inform", operations: [
      { atomicGroup: 1, action: "set", target: "duration", modality: "preferred", precision: "approximate", frame: "actual", quote: "2泊くらい", value: { kind: "quantity", amount: 2, unit: "nights" } },
      { atomicGroup: 2, action: "add_alternative", target: "duration", modality: "acceptable", precision: "exact", frame: "actual", quote: "3泊でも大丈夫", value: { kind: "quantity", amount: 3, unit: "nights" } },
    ], unresolvedFragments: [] })!;
    const delta = acceptedIntentDeltaFromInterpretation({ interpretation, userRequest: "2泊くらい、3泊でも大丈夫", turnId: "00000000-0000-4000-8000-000000000001", baseIntentRevision: 0 });
    expect(delta?.operations.map(({ modality, precision, action }) => [modality, precision, action])).toEqual([
      ["preferred", "approximate", "set"], ["acceptable", "exact", "add_alternative"],
    ]);
  });

  it("rejects a fabricated quote and relative dates without a trusted clock", () => {
    const interpretation = decodeUtteranceInterpretation({ outcome: "delta", speechAct: "inform", operations: [{ atomicGroup: 1, action: "set", target: "start_date",
      frame: "actual", quote: "明日", value: { kind: "relative_date", relation: "tomorrow" } }], unresolvedFragments: [] })!;
    expect(() => acceptedIntentDeltaFromInterpretation({ interpretation, userRequest: "来週", turnId: "00000000-0000-4000-8000-000000000001", baseIntentRevision: 0 })).toThrow();
    expect(() => acceptedIntentDeltaFromInterpretation({ interpretation, userRequest: "明日", turnId: "00000000-0000-4000-8000-000000000001", baseIntentRevision: 0 })).toThrow();
    const inventedExact = decodeUtteranceInterpretation({ outcome: "delta", speechAct: "inform", operations: [{ atomicGroup: 1, action: "set", target: "start_date",
      frame: "actual", quote: "来月", value: { kind: "local_date", date: "2099-01-01" } }], unresolvedFragments: [] })!;
    expect(() => acceptedIntentDeltaFromInterpretation({ interpretation: inventedExact, userRequest: "来月", turnId: "00000000-0000-4000-8000-000000000001",
      baseIntentRevision: 0, calendarDate: "2026-09-25" })).toThrow();
  });

  it("does not treat questions or ambiguity as accepted operations", () => {
    expect(decodeUtteranceInterpretation({ outcome: "no_change", speechAct: "question", operations: [], unresolvedFragments: [] })).toMatchObject({ outcome: "no_change", speechAct: "question" });
    expect(acceptedIntentDeltaFromInterpretation({ interpretation: { outcome: "ambiguous", speechAct: "confirm", operations: [], unresolvedFragments: ["それ"] },
      userRequest: "それで", turnId: "00000000-0000-4000-8000-000000000001", baseIntentRevision: 0 })).toBeUndefined();
  });

  it("resolves an ordinal only through the Application-owned presentation receipt", () => {
    const interpretation = decodeUtteranceInterpretation({ outcome: "delta", speechAct: "confirm", operations: [{ atomicGroup: 1, action: "set",
      target: "candidate_selection", modality: "preferred", precision: "exact", frame: "actual", quote: "2番目",
      value: { kind: "presentation_ordinal", ordinal: 2 } }], unresolvedFragments: [] })!;
    const workingState = { version: 2 as const, revision: 1, sourceTurnId: "00000000-0000-4000-8000-000000000001", sourceUserSequence: 1,
      target: { conversationId: "00000000-0000-4000-8000-000000000010" }, pendingQuestionRefs: [], pendingProposalRefs: [],
      presentations: [{ presentationId: "00000000-0000-4000-8000-000000000020", version: 1 as const,
        entries: [{ ordinal: 1, candidateRef: "candidate:a" }, { ordinal: 2, candidateRef: "candidate:b" }] }],
      semantic: { overlay: { version: 1 as const, intentRevision: 0, facts: [], tombstones: [], appliedMutationIds: [] }, receipts: [] } };
    const delta = acceptedIntentDeltaFromInterpretation({ interpretation, userRequest: "2番目で", turnId: "00000000-0000-4000-8000-000000000002",
      baseIntentRevision: 0, workingState })!;
    expect(delta.operations[0]).toMatchObject({ target: "candidate_selection", value: { kind: "candidate_ref",
      presentationId: "00000000-0000-4000-8000-000000000020", candidateRef: "candidate:b" } });
    const missing = { ...interpretation, operations: [{ ...interpretation.operations[0]!, value: { kind: "presentation_ordinal" as const, ordinal: 3 } }] };
    expect(() => acceptedIntentDeltaFromInterpretation({ interpretation: missing, userRequest: "2番目で", turnId: "00000000-0000-4000-8000-000000000003",
      baseIntentRevision: 0, workingState })).toThrow();
  });

  it("does not let the model self-issue an Application candidate reference", () => {
    expect(decodeUtteranceInterpretation({ outcome: "delta", speechAct: "confirm", operations: [{ atomicGroup: 1, action: "set",
      target: "candidate_selection", frame: "actual", quote: "2番目", value: { kind: "candidate_ref", presentationId: "forged",
        presentationVersion: 1, candidateRef: "candidate:other-owner" } }], unresolvedFragments: [] })).toBeUndefined();
  });
});
