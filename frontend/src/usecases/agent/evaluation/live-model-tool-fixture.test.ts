import { describe, expect, it } from "vitest";
import {
  liveEvaluationAccommodationOutput,
  liveEvaluationPhotoCount,
  liveEvaluationToolEvidence,
  liveEvaluationTravelToolOutput,
  type LiveEvaluationPlace,
  type LiveEvaluationTravelToolName,
} from "./live-model-tool-fixture";

const retrievedAt = "2026-09-21T00:00:00.000Z";
const places: LiveEvaluationPlace[] = [{
  providerPlaceId: "live.izumo-taisha",
  name: "出雲大社",
  municipality: "出雲市",
  sourceUrl: "https://example.com/izumo-taisha",
  photoUrl: "https://images.example.com/izumo-taisha.jpg",
  overview: "出雲市にある神社。参拝と門前町散策を組み合わせられる。",
}];

describe("live model evaluation Tool fixture", () => {
  it.each<LiveEvaluationTravelToolName>([
    "search_place_media",
    "search_web",
    "read_web_pages",
    "resolve_place_candidates",
  ])("returns production-compatible Evidence for %s", (name) => {
    const output = liveEvaluationTravelToolOutput({ name, query: { query: "出雲大社" }, places, retrievedAt });
    const evidence = liveEvaluationToolEvidence(output, { executionId: "eval", retrievedAt });

    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({ category: "external", knowledgeKind: "deterministic_fact" });
    expect(evidence[0]?.references).toEqual([expect.objectContaining({ sourceRef: places[0]?.sourceUrl })]);
  });

  it("binds fetched page prose to a selectable Evidence ID", () => {
    const output = liveEvaluationTravelToolOutput({ name: "read_web_pages", query: {}, places, retrievedAt });
    const [evidence] = liveEvaluationToolEvidence(output, { executionId: "eval", retrievedAt });

    expect(evidence?.id).toBe("live-eval:page:live.izumo-taisha");
    expect(evidence?.facts).toMatchObject({
      status: "available",
      freshness: "fresh",
      sourceTitle: "出雲大社 公式観光案内",
      sourceExcerpt: places[0]?.overview,
    });
  });

  it("returns selectable Evidence for synthetic accommodations", () => {
    const output = liveEvaluationAccommodationOutput({ checkInDate: "2026-09-22", checkOutDate: "2026-09-23" });
    const evidence = liveEvaluationToolEvidence(output, { executionId: "eval", retrievedAt });

    expect(evidence).toHaveLength(3);
    expect(evidence[0]).toMatchObject({
      id: "accommodation:live-eval:izumo-1",
      facts: { resultKind: "accommodation", availability: "unknown" },
    });
  });

  it("counts production image.url and legacy imageUrl shapes without duplicates", () => {
    const placeOutput = liveEvaluationTravelToolOutput({
      name: "search_place_media", query: { query: "出雲大社" }, places, retrievedAt,
    });
    expect(liveEvaluationPhotoCount([
      placeOutput,
      { accommodation: { imageUrl: "https://images.example.com/hotel.jpg" } },
      { duplicate: { image: { url: places[0]?.photoUrl } } },
      { source: { url: places[0]?.sourceUrl } },
    ])).toBe(2);
  });
});
