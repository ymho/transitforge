/** A display snapshot, not a Trip, retained candidate set, or authorization to save. */
export const publicPlacePresentationVersion = "public-place-presentation-v1" as const;
export interface PublicPlacePhoto {
  url: string;
  sourceUrl: string;
  attribution: string;
  license?: string;
}
export interface PublicPlaceCard {
  evidenceId: string;
  placeRef: string;
  title: string;
  description: string;
  sourceUrl: string;
  /** When the cited material was retrieved, not a claim of current opening/availability. */
  retrievedAt?: string;
  photo?: PublicPlacePhoto;
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
    if (!record(card) || !only(card, ["evidenceId", "placeRef", "title", "description", "sourceUrl", "retrievedAt", "photo"]) ||
        !text(card.evidenceId, 240) || !text(card.placeRef, 1000) || !/^place:[^:]+:.+$/u.test(card.placeRef) ||
        !text(card.title, 160) || !text(card.description, 400, true) || !text(card.sourceUrl, 2048) ||
        card.retrievedAt !== undefined && (typeof card.retrievedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(card.retrievedAt) || !Number.isFinite(Date.parse(card.retrievedAt)))) return invalid();
    const sourceUrl = publicPlaceSourceUrl(card.sourceUrl);
    if (!sourceUrl || evidenceIds.has(card.evidenceId) || places.has(card.placeRef)) return invalid();
    evidenceIds.add(card.evidenceId); places.add(card.placeRef);
    let photo: PublicPlacePhoto | undefined;
    if (card.photo !== undefined) {
      if (!record(card.photo) || !only(card.photo, ["url", "sourceUrl", "attribution", "license"]) ||
          !text(card.photo.url, 2048) || !text(card.photo.sourceUrl, 2048) || !text(card.photo.attribution, 240) ||
          card.photo.license !== undefined && !text(card.photo.license, 120)) return invalid();
      const url = publicPhotoUrl(card.photo.url), photoSourceUrl = publicPlaceSourceUrl(card.photo.sourceUrl);
      if (!url || !photoSourceUrl) return invalid();
      photo = { url, sourceUrl: photoSourceUrl, attribution: card.photo.attribution,
        ...(card.photo.license === undefined ? {} : { license: card.photo.license }) };
    }
    return { evidenceId: card.evidenceId, placeRef: card.placeRef, title: card.title,
      description: card.description, sourceUrl, ...(card.retrievedAt === undefined ? {} : { retrievedAt: card.retrievedAt }), ...(photo ? { photo } : {}) };
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
function publicPhotoUrl(value: string): string | undefined {
  const url = publicPlaceSourceUrl(value);
  return url?.startsWith("https://") ? url : undefined;
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function only(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).every((key) => keys.includes(key)); }
function text(value: unknown, maximum: number, multiline = false): value is string {
  const controls = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u;
  return typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= maximum && !controls.test(value);
}
function invalid(): never { throw new Error("Invalid public place presentation"); }
