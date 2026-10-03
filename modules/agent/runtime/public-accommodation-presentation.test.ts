import { expect, it } from "vitest";
import { externalTravelEvidence } from "./external-travel-evidence";
import { admitAgentV2Reply } from "./agent-v2-publication";
import { parsePublicAccommodationPresentation } from "./public-accommodation-presentation";
import { validateEvidenceAndClaims } from "./evidence-model";

it("publishes three hotel comparisons even when the answer selected one name, without inventing a stay total", () => {
  const evidence = externalTravelEvidence({ searchAdults: 1, accommodations: [1, 2, 3].map(id => ({ kind: "accommodation", provider: "fixture", providerItemId: String(id), name: `宿${id}`,
    checkInDate: "2026-10-04", checkOutDate: "2026-10-05", availability: id === 1 ? "available" : "unknown",
    bookingUrl: `https://example.org/hotel/${id}`, reviewAverage: 4.24,
    price: { price: { currency: "JPY", amountMinor: 5100 }, observedAt: "2026-10-03T00:00:00Z", basis: "reference-minimum" } })) },
  { retrievedAt: "2026-10-03T00:00:00Z", executionId: "execution", toolCallId: "hotels", toolName: "search_accommodations", queryFingerprint: "query" });
  const final = admitAgentV2Reply({ kind: "answer", references: [{ evidenceId: evidence[0]!.id, field: "name" }], commentary: "宿泊候補を比較できます。" }, { executionId: "execution", evidence });
  expect(final.publicAccommodationPresentation?.cards).toHaveLength(3);
  expect(final.evidence).toHaveLength(3);
  expect(validateEvidenceAndClaims(final.evidence, final.claims).valid).toBe(true);
  expect(final.publicAccommodationPresentation?.cards[0]?.summary).toContain("参考最安値: JPY 5,100");
  expect(final.publicAccommodationPresentation?.cards[1]?.summary).toContain("空室は未確認");
  expect(JSON.stringify(final)).not.toContain("1泊2名");
  expect(() => parsePublicAccommodationPresentation({ ...final.publicAccommodationPresentation, rawToolOutput: {} })).toThrow();
  const other = structuredClone(evidence[2]!); other.id = "other-query"; other.observation!.scopeKey = "other-scope";
  expect(admitAgentV2Reply({ kind: "answer", references: [{ evidenceId: evidence[0]!.id, field: "name" }] }, { executionId: "execution", evidence: [...evidence, other] }).publicAccommodationPresentation?.cards).toHaveLength(3);
});
