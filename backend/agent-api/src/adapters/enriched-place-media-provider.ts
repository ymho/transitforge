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
    private readonly identityFallback?: PlaceMediaProvider,
  ) {}

  async search(query: PlaceMediaQuery): Promise<ExternalTravelInformation<PlaceMediaSearchResult>> {
    const requestedLimit = Math.max(1, Math.min(8, Math.round(query.limit ?? 5)));
    const primaryResult = await this.primary.search(query);
    const useIdentityFallback = !primaryResult.data?.places.length
      && primaryResult.failure?.code === "unauthorized"
      && this.identityFallback !== undefined;
    const primary = useIdentityFallback
      ? identityOnly(await this.identityFallback!.search({ ...query, limit: 8 }))
      : primaryResult;
    if (!primary.data?.places.length) return primary;

    const rankedPlaces = rankPlaces(primary.data.places, query.query).slice(0, requestedLimit);
    const enrichmentResults = await Promise.all(rankedPlaces.slice(0, 4).map((place) =>
      this.enrichment.search({ query: place.name, limit: 3, ...(query.detail ? { detail: true } : {}) }),
    ));
    const usedEvidence: ExternalSourceEvidence[] = [];
    const places = rankedPlaces.map((place, index) => {
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

function identityOnly(
  information: ExternalTravelInformation<PlaceMediaSearchResult>,
): ExternalTravelInformation<PlaceMediaSearchResult> {
  if (!information.data) return information;
  return {
    ...information,
    data: {
      places: information.data.places.map((place) => ({
        ...place,
        summary: undefined,
        detail: undefined,
        image: undefined,
        images: undefined,
      })),
    },
  };
}

function enrichPlace(primary: PlaceMedia, enrichment: PlaceMedia): PlaceMedia {
  const enrichmentImages = enrichment.images ?? (enrichment.image ? [enrichment.image] : []);
  const primaryImages = primary.images ?? (primary.image ? [primary.image] : []);
  const images = uniqueImages(enrichmentImages.length ? enrichmentImages : primaryImages);
  return {
    ...primary,
    ...(primary.summary || !enrichment.summary ? {} : { summary: enrichment.summary }),
    ...((enrichment.image ?? primary.image) ? { image: enrichment.image ?? primary.image } : {}),
    ...(images.length ? { images } : {}),
    sources: uniqueSources([
      ...(primary.sources ?? []),
      ...(enrichment.sources ?? [{
        provider: "external-media",
        label: enrichment.image?.attribution ?? "Web",
        url: enrichment.sourceUrl,
        role: "discovery" as const,
      }]),
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

function rankPlaces(places: PlaceMedia[], query: string): PlaceMedia[] {
  const normalizedQuery = normalizeName(query);
  return places.map((place, index) => ({ place, index, score: nameMatchScore(place.name, normalizedQuery) }))
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .map(({ place }) => place);
}

function nameMatchScore(name: string, normalizedQuery: string): number {
  const normalizedName = normalizeName(name);
  if (normalizedName === normalizedQuery) return 0;
  if (normalizedName.includes(normalizedQuery)) return 1;
  if (normalizedQuery.includes(normalizedName)) return 2;
  return 3;
}

function normalizeName(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ja").replace(/[\s・･,，.。()（）「」『』]/gu, "");
}
