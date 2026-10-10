import { expect, it } from "vitest";
import { externalTravelEvidence } from "./external-travel-evidence";
import { admitAgentV2Reply, agentV2CandidateReferences } from "./agent-v2-publication";
import { parsePublicAccommodationPresentation } from "./public-accommodation-presentation";
import { validateEvidenceAndClaims } from "./evidence-model";

it("publishes three hotel comparisons even when the answer selected one name, without inventing a stay total", () => {
  const evidence = externalTravelEvidence({ searchAdults: 1, accommodations: [1, 2, 3].map(id => ({ kind: "accommodation", provider: "fixture", providerItemId: String(id), name: `宿${id}`,
    checkInDate: "2026-10-04", checkOutDate: "2026-10-05", availability: id === 1 ? "available" : "unknown",
    bookingUrl: `https://example.org/hotel/${id}`, reviewAverage: 4.24, imageUrl: `https://example.org/hotel/${id}.jpg`,
    price: { price: { currency: "JPY", amountMinor: 5100 }, observedAt: "2026-10-03T00:00:00Z", basis: "reference-minimum" } })) },
  { retrievedAt: "2026-10-03T00:00:00Z", executionId: "execution", toolCallId: "hotels", toolName: "search_accommodations", queryFingerprint: "query" });
  const final = admitAgentV2Reply({ kind: "answer", references: [{ evidenceId: evidence[0]!.id, field: "name" }], commentary: "宿泊候補を比較できます。" }, { executionId: "execution", evidence });
  expect(final.publicAccommodationPresentation?.cards).toHaveLength(3);
  expect(final.publicAccommodationPresentation?.cards[0]).toMatchObject({ imageUrl: "https://example.org/hotel/1.jpg", reviewAverage: 4.24, provider: "fixture" });
  for (const invalid of ["javascript:alert(1)", "http://example.org/photo.jpg", "https://example.org/photo?token=secret"]) {
    expect(() => parsePublicAccommodationPresentation({ version: "public-accommodation-presentation-v1", cards: [{ ...final.publicAccommodationPresentation!.cards[0], imageUrl: invalid }] })).toThrow();
  }
  expect(final.evidence).toHaveLength(3);
  const panelOnly = admitAgentV2Reply({ kind: "answer", references: [{ evidenceId: evidence[0]!.id, field: "accommodationSummary" }] }, { executionId: "execution", evidence });
  expect(panelOnly.text).toBe("宿泊候補をパネルで比較できます。");
  expect(panelOnly.publicAccommodationPresentation).toEqual(final.publicAccommodationPresentation);
  expect(validateEvidenceAndClaims(panelOnly.evidence, panelOnly.claims).valid).toBe(true);
  expect(validateEvidenceAndClaims(final.evidence, final.claims).valid).toBe(true);
  expect(final.publicAccommodationPresentation?.cards[0]?.summary).toContain("参考最安値: JPY 5,100");
  expect(final.publicAccommodationPresentation?.cards[1]?.summary).toContain("空室は未確認");
  expect(JSON.stringify(final)).not.toContain("1泊2名");
  expect(() => parsePublicAccommodationPresentation({ ...final.publicAccommodationPresentation, rawToolOutput: {} })).toThrow();
  const other = structuredClone(evidence[2]!); other.id = "other-query"; other.observation!.scopeKey = "other-scope";
  expect(admitAgentV2Reply({ kind: "answer", references: [{ evidenceId: evidence[0]!.id, field: "name" }] }, { executionId: "execution", evidence: [...evidence, other] }).publicAccommodationPresentation?.cards).toHaveLength(3);
  const offered = agentV2CandidateReferences(evidence);
  expect(offered).toHaveLength(3);
  const candidates = admitAgentV2Reply({ kind: "candidates", evidenceIds: offered.map(item => item.evidenceId), commentary: "宿泊候補を比較できます。" }, { executionId: "execution", evidence });
  expect(candidates.proof.kind).toBe("candidates");
  expect(candidates.publicAccommodationPresentation).toEqual(final.publicAccommodationPresentation);
  expect(validateEvidenceAndClaims(candidates.evidence, candidates.claims).valid).toBe(true);
  const stale = structuredClone(evidence[0]!); stale.observation!.state = "stale";
  expect(agentV2CandidateReferences([stale])).toEqual([]);
  expect(() => admitAgentV2Reply({ kind: "candidates", evidenceIds: [stale.id], commentary: "宿泊候補です。" }, { executionId: "execution", evidence: [stale] })).toThrow();
  const incomplete = structuredClone(evidence[0]!); delete incomplete.facts.accommodationSummary;
  expect(agentV2CandidateReferences([incomplete])).toEqual([]);
  expect(() => admitAgentV2Reply({ kind: "candidates", evidenceIds: [incomplete.id], commentary: "宿泊候補です。" }, { executionId: "execution", evidence: [incomplete] })).toThrow();
});
