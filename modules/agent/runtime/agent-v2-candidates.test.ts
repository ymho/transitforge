import { describe, expect, it } from "vitest";
import { admitAgentV2Reply, agentV2CandidateReferences } from "./agent-v2-publication";
import { parseAgentV2Reply } from "./agent-v2-reply";
import { externalTravelEvidence } from "./external-travel-evidence";
import { validateEvidenceAndClaims, type Evidence } from "./evidence-model";
import type { EffectiveIntent } from "./effective-intent";
import { parsePublicPlacePresentation } from "./public-place-presentation";

const intent: EffectiveIntent = { version: 1, base: { source: "none", fingerprint: "base" }, intentRevision: 1,
  activeBaseFacts: [], actualConversationFacts: [], profileHints: [], ignoredProfileSettings: [], hypotheticalFacts: [],
  retractions: [], suppressedBaseRefs: [], profileSuppressions: [], fingerprint: "intent-1" };
function place(id = "garden", title = "庭園", description = "池の周囲を歩いて見学する庭園です。"): Evidence {
  const sourceUrl = `https://example.org/places/${id}`;
  const [evidence] = externalTravelEvidence({ result: { status: "available", freshness: "fresh",
    data: { places: [{ providerPlaceId: id, name: title, summary: description, sourceUrl }] },
    evidence: [{ id: `provider:${id}`, provider: "fixture", sourceUrl, retrievedAt: "2026-09-26T10:00:00Z" }],
  } }, { executionId: "v2-cards", toolCallId: id, toolName: "search_place_media", queryFingerprint: id,
    retrievedAt: "2026-09-26T10:00:00Z" });
  return { ...evidence!, intentDependency: { intentRevision: intent.intentRevision, fingerprint: intent.fingerprint, targets: ["destination"] } };
}
function submit(evidence: Evidence[], ids = evidence.map(({ id }) => id), effectiveIntent = intent) {
  return admitAgentV2Reply({ kind: "candidates", evidenceIds: ids, commentary: "散策先として、この候補を検討できます。" },
    { executionId: "v2-cards", evidence, effectiveIntent });
}

describe("V2 place candidate publication", () => {
  it("projects a real place Evidence mapper result without requiring a photo or inventing a Trip", () => {
    const evidence = place();
    const result = submit([evidence]);
    expect(result.publicPlacePresentation?.cards).toEqual([{ evidenceId: evidence.id,
      placeRef: "place:fixture:garden", title: "庭園", description: "池の周囲を歩いて見学する庭園です。",
      sourceUrl: "https://example.org/places/garden" }]);
    expect(result.text).toBe("散策先として、この候補を検討できます。");
    expect(result.text).not.toContain("池の周囲");
    expect(result.proof).toMatchObject({ kind: "candidates", commentary: true });
    expect(validateEvidenceAndClaims(result.evidence, result.claims).valid).toBe(true);
    expect(agentV2CandidateReferences([evidence], intent)).toEqual([{ evidenceId: evidence.id, title: "庭園" }]);
    expect(JSON.stringify(result.publicPlacePresentation)).not.toMatch(/image|price|reservation|tripId|candidateSetId/u);
  });
  it("preserves model-selected order without fixing the number of candidates", () => {
    const garden = place(), museum = place("museum", "美術館");
    expect(submit([garden, museum], [museum.id, garden.id]).publicPlacePresentation?.cards.map(({ title }) => title)).toEqual(["美術館", "庭園"]);
    expect(submit([garden, museum], [museum.id]).publicPlacePresentation?.cards).toHaveLength(1);
  });
  it("binds a bounded excerpt and not the full source text into a card", () => {
    const evidence = place("garden", "庭園", "資料の説明です。".repeat(100));
    const result = submit([evidence]);
    expect(result.publicPlacePresentation?.cards[0]?.description.length).toBeLessThanOrEqual(400);
    expect(validateEvidenceAndClaims(result.evidence, result.claims).valid).toBe(true);
    expect(result.text).not.toContain("資料の説明です。");
  });
  it("keeps a valid bounded quote when the excerpt limit falls on source whitespace", () => {
    const evidence = place("garden", "庭園", "文".repeat(398) + " \n続きの資料です。");
    const result = submit([evidence]);
    expect(result.publicPlacePresentation?.cards[0]?.description).toBe("文".repeat(398));
    expect(agentV2CandidateReferences([evidence], intent)).toHaveLength(1);
    expect(validateEvidenceAndClaims(result.evidence, result.claims).valid).toBe(true);
  });
  it.each(["search-snippet", "read-page"])("does not promote a %s to a resolved place candidate", (sourcePrecision) => {
    const evidence = place(); evidence.facts.sourcePrecision = sourcePrecision;
    expect(agentV2CandidateReferences([evidence], intent)).toEqual([]);
    expect(() => submit([evidence])).toThrow();
  });
  it.each(["stale", "superseded"])("does not publish %s observations as current candidates", (state) => {
    const evidence = place(); evidence.observation = { ...evidence.observation!, state: state as "stale" };
    expect(agentV2CandidateReferences([evidence], intent)).toEqual([]);
    expect(() => submit([evidence])).toThrow();
  });
  it("rejects unresolved subjects and mismatched source references", () => {
    const unresolved = place(); unresolved.observation!.subjectKey = "source:fixture:unresolved";
    const mismatched = place(); mismatched.facts.sourceUrl = "https://example.org/another-place";
    for (const evidence of [unresolved, mismatched]) {
      expect(agentV2CandidateReferences([evidence], intent)).toEqual([]);
      expect(() => submit([evidence])).toThrow();
    }
  });
  it("rejects old or unbound Evidence after a condition change", () => {
    const evidence = place();
    expect(() => submit([evidence], [evidence.id], { ...intent, intentRevision: 2, fingerprint: "intent-2" })).toThrow();
    const { intentDependency: _binding, ...unbound } = evidence;
    expect(agentV2CandidateReferences([unbound], intent)).toEqual([]);
    expect(() => submit([unbound])).toThrow();
  });
  it("cannot publish an unknown, colliding or duplicate-place reference", () => {
    const evidence = place();
    expect(() => submit([evidence], ["foreign-evidence"])).toThrow();
    expect(() => submit([evidence, structuredClone(evidence)], [evidence.id])).toThrow();
    expect(() => submit([evidence, { ...evidence, id: "other-observation" }])).toThrow();
  });
  it("does not accept model-supplied card data or mutation outcomes", () => {
    const evidence = place();
    for (const extra of [{ cards: [] }, { title: "架空の場所" }, { sourceUrl: "https://example.org/forged" },
      { imageUrl: "https://example.org/image.jpg" }, { receiptId: "saved" }]) {
      expect(() => parseAgentV2Reply({ kind: "candidates", evidenceIds: [evidence.id], commentary: "候補を比較します。", ...extra })).toThrow();
    }
  });
  it.each(["javascript:alert(1)", "https://user:password@example.org/place", "https://example.org/place?access_token=private"])("rejects an unsafe source URL %s", (sourceUrl) => {
    const evidence = place(); evidence.facts.sourceUrl = sourceUrl; evidence.references[0]!.sourceRef = sourceUrl;
    expect(agentV2CandidateReferences([evidence], intent)).toEqual([]);
    expect(() => submit([evidence])).toThrow();
  });
  it("does not fabricate cards for an empty result and can publish uncertainty instead", () => {
    expect(agentV2CandidateReferences([], intent)).toEqual([]);
    expect(() => submit([])).toThrow();
    expect(admitAgentV2Reply({ kind: "uncertainty" }, { executionId: "empty", evidence: [] })).not.toHaveProperty("publicPlacePresentation");
  });
  it("retains only a detached and structurally validated public snapshot", () => {
    const presentation = submit([place()]).publicPlacePresentation!;
    const parsed = parsePublicPlacePresentation(presentation);
    presentation.cards[0]!.title = "changed";
    expect(parsed.cards[0]!.title).toBe("庭園");
    expect(() => parsePublicPlacePresentation({ ...parsed, ownerSubject: "foreign" })).toThrow();
    expect(() => parsePublicPlacePresentation({ ...parsed, cards: [{ ...parsed.cards[0], imageUrl: "https://example.org/image" }] })).toThrow();
  });
});
