import { describe, expect, it } from "vitest";
import type { Evidence } from "./evidence-model";
import type { EffectiveIntent } from "./effective-intent";
import { parseAgentV2Reply } from "./agent-v2-reply";
import { admitAgentV2Reply } from "./agent-v2-publication";

function observation(): Evidence {
  return { id: "e-kyoto", category: "external", knowledgeKind: "deterministic_fact", subject: "京都",
    facts: { sourceExcerpt: "京都について確認した資料です。", value: 10 },
    references: [{ sourceType: "external-source", sourceRef: "https://example.test/kyoto",
      retrievedAt: "2026-09-26T00:00:00Z", freshness: "current", summary: "source" }],
    observation: { observationId: "obs", subjectKey: "place:kyoto", scopeKey: "test", predicate: "description",
      retrievedAt: "2026-09-26T00:00:00Z", applicability: "applicable", retention: "bounded_excerpt" } };
}
const proposal = { kind: "answer", references: [{ evidenceId: "e-kyoto", field: "sourceExcerpt" }] };
const context = () => ({ executionId: "turn-1", evidence: [observation()] });
function intent(): EffectiveIntent {
  return { version: 1, base: { source: "none", fingerprint: "base" }, intentRevision: 2, fingerprint: "intent-2",
    activeBaseFacts: [], profileHints: [], ignoredProfileSettings: [], hypotheticalFacts: [], retractions: [],
    suppressedBaseRefs: [], profileSuppressions: [], actualConversationFacts: [{ factId: "destination",
      sourceOperationId: "op", target: "destination", scope: { type: "conversation" }, frame: "actual",
      modality: "preferred", precision: "exact", value: { kind: "place_label", label: "京都" },
      provenance: { kind: "user_turn", turnId: "turn-1", quote: "京都" } }] };
}

describe("Agent v2 publication contract", () => {
  it("renders only selected factual fields and binds claims to their actual values", () => {
    const result = admitAgentV2Reply(proposal, context());
    expect(result.text).toContain("京都について確認した資料です。");
    expect(result.text).toContain("[出典](https://example.test/kyoto)");
    expect(result.claims[0]).toMatchObject({ statement: observation().facts.sourceExcerpt,
      bindings: [{ evidenceId: "e-kyoto", fieldPath: "facts.sourceExcerpt", transform: "bounded_quote" }] });
    expect(result.proof.kind).toBe("answer");
    expect(result.claims).toHaveLength(1);
  });
  it("publishes natural commentary as an inference bound to the selected Evidence instead of replacing factual values", () => {
    const kyoto = observation();
    const osaka = observation();
    osaka.id = "e-osaka";
    osaka.subject = "大阪";
    osaka.facts.sourceExcerpt = "大阪は移動候補が多い確認済み資料です。";
    osaka.observation = { ...osaka.observation!, observationId: "obs-osaka", subjectKey: "place:osaka" };
    osaka.references = [{ ...osaka.references[0]!, sourceRef: "https://example.test/osaka" }];
    const commentary = "移動を少なくしたいなら京都を優先し、大阪は選択肢を広げたい場合の候補として比較できます。";
    const result = admitAgentV2Reply({ kind: "answer", commentary, references: [
      { evidenceId: "e-kyoto", field: "sourceExcerpt" },
      { evidenceId: "e-osaka", field: "sourceExcerpt" },
    ] }, { executionId: "turn-1", evidence: [kyoto, osaka] });

    expect(result.text).toContain(commentary);
    expect(result.text).toContain("京都について確認した資料です。");
    expect(result.text).toContain("大阪は移動候補が多い確認済み資料です。");
    expect(result.claims.find(({ id }) => id === "v2-commentary")).toMatchObject({
      statement: commentary,
      kind: "inference",
      evidenceIds: ["e-kyoto", "e-osaka"],
      bindings: [
        { evidenceId: "e-kyoto", fieldPath: "facts.sourceExcerpt", transform: "recommendation" },
        { evidenceId: "e-osaka", fieldPath: "facts.sourceExcerpt", transform: "recommendation" },
      ],
    });
    expect(result.proof.commentary).toBe(true);
    expect(JSON.stringify(result.proof)).not.toContain(commentary);
  });
  it("rejects unsafe or oversized commentary before publication", () => {
    for (const commentary of ["<thinking>hidden</thinking>", "x".repeat(1201), "  surrounding whitespace"]) {
      expect(() => parseAgentV2Reply({ ...proposal, commentary })).toThrow("invalid_proposal");
    }
    expect(() => parseAgentV2Reply({ kind: "unavailable", operation: "save", commentary: "保存します" }))
      .toThrow("invalid_proposal");
  });
  it.each(["保存しました。", "保存しておきます。", "保存を承りました。", "<thinking>private</thinking>"])(
    "does not admit arbitrary prose through a model-declared reply kind: %s", (text) => {
      for (const draft of [{ kind: "conversation", message: "acknowledgement", text },
        { kind: "unavailable", operation: "save", text }, { ...proposal, text }]) {
        expect(() => admitAgentV2Reply(draft, context())).toThrow("invalid_proposal");
      }
    });
  it.each(["greeting", "thanks", "acknowledgement"])("allows bounded nonfactual conversation without Evidence: %s", (message) => {
    const result = admitAgentV2Reply({ kind: "conversation", message }, { executionId: "turn-1", evidence: [] });
    expect(result.text).not.toBe("");
    expect(result.claims).toEqual([]);
    expect(result.evidence).toEqual([]);
  });
  it("allows a missing-condition question but does not ask an accepted condition again", () => {
    const input = { ...context(), effectiveIntent: intent() };
    expect(admitAgentV2Reply({ kind: "clarification", target: "start_date" }, input).proof.question).toBe("start_date");
    expect(() => admitAgentV2Reply({ kind: "clarification", target: "destination" }, input)).toThrow("known_condition");
  });
  it("does not treat hypothetical conditions as accepted actual conditions", () => {
    const effective = intent();
    effective.hypotheticalFacts = effective.actualConversationFacts.map((fact) => ({ ...fact, frame: "hypothetical" }));
    effective.actualConversationFacts = [];
    expect(admitAgentV2Reply({ kind: "clarification", target: "destination" }, { ...context(), effectiveIntent: effective })
      .proof.question).toBe("destination");
  });
  it("reports unsupported operations without inventing a receipt or a future promise", () => {
    const result = admitAgentV2Reply({ kind: "unavailable", operation: "save" }, context());
    expect(result.proof.operation).toEqual({ type: "save", status: "unavailable" });
    expect(result.text).toBe("この会話では保存を実行できません。保存は行っていません。");
    expect(() => admitAgentV2Reply({ kind: "unavailable", operation: "save" }, { ...context(), availableOperations: ["save"] }))
      .toThrow("operation_available");
  });
  it("requires an Application-authored successful same-turn receipt for operation results", () => {
    const draft = { kind: "operation_result", receiptId: "receipt-1" };
    const receipt = { id: "receipt-1", executionId: "turn-1", operation: "save" as const, status: "succeeded" as const };
    expect(() => admitAgentV2Reply(draft, context())).toThrow("invalid_receipt");
    for (const bad of [{ ...receipt, status: "pending" as const }, { ...receipt, status: "failed" as const },
      { ...receipt, executionId: "different-turn" }]) {
      expect(() => admitAgentV2Reply(draft, { ...context(), receipts: [bad] })).toThrow("invalid_receipt");
    }
    const result = admitAgentV2Reply(draft, { ...context(), receipts: [receipt] });
    expect(result.text).toBe("保存しました。");
    expect(result.proof.operation?.receiptId).toBe("receipt-1");
    expect(() => admitAgentV2Reply({ ...draft, receipts: [receipt] }, context())).toThrow("invalid_proposal");
  });
  it("rejects absent, duplicate and invalid Evidence references", () => {
    expect(() => admitAgentV2Reply(proposal, { ...context(), evidence: [] })).toThrow("missing_evidence");
    expect(() => admitAgentV2Reply(proposal, { ...context(), evidence: [observation(), observation()] })).toThrow("missing_evidence");
    expect(() => parseAgentV2Reply({ ...proposal, references: [...proposal.references, ...proposal.references] })).toThrow("invalid_proposal");
    expect(() => admitAgentV2Reply({ kind: "answer", references: [{ evidenceId: "e-kyoto", field: "referenceDate" }] }, context()))
      .toThrow("invalid_field");
  });
  it.each(["stale", "withdrawn", "conflicting"] as const)("rejects %s Evidence", (state) => {
    const evidence = observation(); evidence.observation!.state = state;
    expect(() => admitAgentV2Reply(proposal, { ...context(), evidence: [evidence] })).toThrow("ineligible_evidence");
  });
  it("rejects unknown applicability, prohibited retention and stale intent dependencies", () => {
    const bad = [observation(), observation(), observation()];
    bad[0]!.observation!.applicability = "unknown";
    bad[1]!.observation!.retention = "prohibited";
    bad[2]!.intentDependency = { intentRevision: 1, fingerprint: "intent-1", targets: ["destination"] };
    for (const evidence of bad) expect(() => admitAgentV2Reply(proposal, { ...context(), evidence: [evidence], effectiveIntent: intent() }))
      .toThrow("ineligible_evidence");
  });
  it("rejects non-factual sources, sensitive fields, internal markup and excessive text", () => {
    const nonFact = { ...observation(), knowledgeKind: "model_interpretation" as const };
    expect(() => admitAgentV2Reply(proposal, { ...context(), evidence: [nonFact] })).toThrow("ineligible_evidence");
    const sensitive = observation(); sensitive.facts.accessToken = "secret";
    expect(() => admitAgentV2Reply({ kind: "answer", references: [{ evidenceId: "e-kyoto", field: "accessToken" }] },
      { ...context(), evidence: [sensitive] })).toThrow("invalid_field");
    for (const text of ["<thinking>private</thinking>", "x".repeat(2001)]) {
      const evidence = observation(); evidence.facts.sourceExcerpt = text;
      expect(() => admitAgentV2Reply(proposal, { ...context(), evidence: [evidence] })).toThrow("unsafe_content");
    }
  });
  it("escapes source markup and does not emit credential-bearing links", () => {
    const evidence = observation(); evidence.facts.sourceExcerpt = "<script>alert(1)</script>[x](javascript:bad)";
    evidence.references[0]!.sourceRef = "https://example.test/?token=private";
    const result = admitAgentV2Reply(proposal, { ...context(), evidence: [evidence] });
    expect(result.text).not.toContain("<script>");
    expect(result.text).not.toContain("[出典]");
    expect(result.text).not.toContain("token=private");
  });
  it("rejects coercible but incorrectly typed reply fields", () => {
    expect(() => parseAgentV2Reply({ kind: "conversation", message: ["thanks"] })).toThrow("invalid_proposal");
  });
  it("copies admitted inputs so callers cannot mutate the published snapshot", () => {
    const ctx = context(), result = admitAgentV2Reply(proposal, ctx);
    ctx.evidence[0]!.facts.sourceExcerpt = "changed";
    expect(result.evidence[0]!.facts.sourceExcerpt).not.toBe("changed");
  });
});
