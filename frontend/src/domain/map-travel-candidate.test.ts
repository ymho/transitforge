import { describe, expect, it } from "vitest";
import type { PlaceMedia } from "@raiquora/trip/place-media";
import { mapPlaceCandidates, mergeMapPlaceDetailCandidate } from "./map-travel-candidate";

const image = (name: string) => ({
  url: `https://images.example/${name}.jpg`, attribution: "Example", hotlinkAllowed: true as const,
});
const place = (overrides: Partial<PlaceMedia> = {}): PlaceMedia => ({
  providerPlaceId: "mapbox:target", name: "対象施設", latitude: 35, longitude: 135,
  sourceUrl: "https://example.com/target", openingHoursStatus: "unknown",
  sources: [{ provider: "mapbox", role: "identity", label: "Mapbox", url: "https://example.com/target" }],
  targetBinding: { status: "resolved", reason: "stable-id" },
  summary: "以前の説明", image: image("excluded-banner"), images: [image("excluded-banner")],
  ...overrides,
});

describe("bound place detail snapshot replacement", () => {
  it.each<Partial<PlaceMedia>>([
    { targetBinding: { status: "mismatch", reason: "different-id" } },
    { targetBinding: { status: "unresolved", reason: "missing-binding" } },
    { providerPlaceId: "mapbox:other" },
    { sources: [{ provider: "wikipedia", role: "identity", label: "Wikipedia", url: "https://example.com/target" }] },
  ])("rejects unbound detail before replacing images: %j", (unbound) => {
    const candidate = mapPlaceCandidates([place()])[0]!;
    const detail = place({ summary: "別の説明", image: image("wrong"), images: [image("wrong")], ...unbound });
    expect(mergeMapPlaceDetailCandidate(candidate, detail)).toBe(candidate);
    expect(candidate.imageUrl).toBe(image("excluded-banner").url);
    expect(candidate.summary).toBe("以前の説明");
  });

  it.each([true, false])("replaces the resolved gallery without resurrecting removed images (photos=%s)", (photos) => {
    const candidate = mapPlaceCandidates([place()])[0]!;
    const images = photos ? [image("latest"), image("second")] : [];
    const merged = mergeMapPlaceDetailCandidate(candidate, place({
      summary: "最新の説明", image: images[0], images,
    }));
    expect(merged.value.images).toEqual(images);
    expect(merged.value.image).toEqual(images[0]);
    expect(merged.imageUrl).toBe(images[0]?.url);
    expect(merged.summary).toBe("最新の説明");
    expect(JSON.stringify(merged)).not.toContain("excluded-banner");
    expect(candidate.value.images).toEqual([image("excluded-banner")]);
  });
});
