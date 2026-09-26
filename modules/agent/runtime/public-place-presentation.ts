/** A display snapshot, not a Trip, retained candidate set, or authorization to save. */
export const publicPlacePresentationVersion = "public-place-presentation-v1" as const;
export interface PublicPlaceCard {
  evidenceId: string;
  placeRef: string;
  title: string;
  description: string;
  sourceUrl: string;
}
export interface PublicPlacePresentation {
  version: typeof publicPlacePresentationVersion;
  cards: PublicPlaceCard[];
}

/** Shared storage/transport validation. Only the Application may construct cards
 * from admitted Evidence. This parser does not establish factual authority. */
export function parsePublicPlacePresentation(value: unknown): PublicPlacePresentation {
  if (!record(value) || !exact(value, ["version", "cards"]) || value.version !== publicPlacePresentationVersion ||
      !Array.isArray(value.cards) || value.cards.length < 1 || value.cards.length > 8) return invalid();
  const evidenceIds = new Set<string>(), places = new Set<string>();
  const cards = value.cards.map((card): PublicPlaceCard => {
    if (!record(card) || !exact(card, ["evidenceId", "placeRef", "title", "description", "sourceUrl"]) ||
        !text(card.evidenceId, 240) || !text(card.placeRef, 1000) || !/^place:[^:]+:.+$/u.test(card.placeRef) ||
        !text(card.title, 160) || !text(card.description, 400) || !text(card.sourceUrl, 2048)) return invalid();
    const sourceUrl = publicPlaceSourceUrl(card.sourceUrl);
    if (!sourceUrl || evidenceIds.has(card.evidenceId) || places.has(card.placeRef)) return invalid();
    evidenceIds.add(card.evidenceId); places.add(card.placeRef);
    return { evidenceId: card.evidenceId, placeRef: card.placeRef, title: card.title,
      description: card.description, sourceUrl };
  });
  const result: PublicPlacePresentation = { version: publicPlacePresentationVersion, cards };
  if (new TextEncoder().encode(JSON.stringify(result)).length > 32 * 1024) return invalid();
  return result;
}
export function publicPlaceSourceUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password ||
        [...url.searchParams.keys()].some((key) => /(?:token|secret|password|credential|authorization|cookie|signature|api_?key)/iu.test(key))) return undefined;
    url.hash = "";
    return url.href;
  } catch { return undefined; }
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function text(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/u.test(value);
}
function invalid(): never { throw new Error("Invalid public place presentation"); }
