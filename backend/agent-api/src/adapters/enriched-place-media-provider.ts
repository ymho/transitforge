import { availableExternalInformation } from "@raiquora/trip/external-travel-information";
import type { ExternalTravelInformation } from "@raiquora/trip/external-travel-information";
import type { ExternalSourceEvidence } from "@raiquora/trip/external-travel-information";
import type {
  PlaceMedia,
  PlaceMediaProvider,
  PlaceMediaQuery,
  PlaceMediaSearchResult,
} from "@raiquora/trip/place-media";

export class EnrichedPlaceMediaProvider implements PlaceMediaProvider {
  constructor(
    private readonly primary: PlaceMediaProvider,
    private readonly enrichment: PlaceMediaProvider,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async search(query: PlaceMediaQuery): Promise<ExternalTravelInformation<PlaceMediaSearchResult>> {
    const primary = await this.primary.search(query);
    if (!primary.data?.places.length) {
      return primary.failure?.code === "unauthorized"
        ? this.enrichment.search(query)
        : primary;
    }

    const enrichmentResults = await Promise.all(primary.data.places.slice(0, 4).map((place) =>
      this.enrichment.search({ query: place.name, limit: 3, ...(query.detail ? { detail: true } : {}) }),
    ));
    const usedEvidence: ExternalSourceEvidence[] = [];
    const places = primary.data.places.map((place, index) => {
      const enrichment = enrichmentResults[index];
      const match = enrichment?.data?.places.find((candidate) => samePlaceName(place.name, candidate.name));
      if (!match || !enrichment) return place;
      usedEvidence.push(...enrichment.evidence);
      return enrichPlace(place, match);
    });
    return availableExternalInformation(
      { places },
      [...primary.evidence, ...usedEvidence],
      this.now(),
    );
  }
}

function enrichPlace(primary: PlaceMedia, enrichment: PlaceMedia): PlaceMedia {
  const images = uniqueImages([
    ...(primary.images ?? (primary.image ? [primary.image] : [])),
    ...(enrichment.images ?? (enrichment.image ? [enrichment.image] : [])),
  ]);
  return {
    ...primary,
    ...(primary.summary || !enrichment.summary ? {} : { summary: enrichment.summary }),
    ...(primary.image || !enrichment.image ? {} : { image: enrichment.image }),
    ...(images.length ? { images } : {}),
    sources: uniqueSources([
      ...(primary.sources ?? []),
      { provider: "wikipedia", label: "Wikipedia", url: enrichment.sourceUrl, role: "description" as const },
    ]),
  };
}

function uniqueImages(images: NonNullable<PlaceMedia["images"]>): NonNullable<PlaceMedia["images"]> {
  return [...new Map(images.map((image) => [image.url, image])).values()].slice(0, 8);
}

function uniqueSources(sources: NonNullable<PlaceMedia["sources"]>): NonNullable<PlaceMedia["sources"]> {
  return [...new Map(sources.map((source) => [`${source.provider}:${source.url}`, source])).values()];
}

function samePlaceName(left: string, right: string): boolean {
  const normalizedLeft = normalizeName(left);
  const normalizedRight = normalizeName(right);
  return normalizedLeft === normalizedRight || (
    Math.min(normalizedLeft.length, normalizedRight.length) >= 4 &&
    (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft))
  );
}

function normalizeName(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ja").replace(/[\s・･,，.。()（）「」『』]/gu, "");
}
