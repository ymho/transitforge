import { publicPlaceSourceUrl } from "./public-place-presentation";

/** Provider-derived comparison only. This snapshot never selects or books a stay. */
export interface PublicAccommodationPresentation {
  version: "public-accommodation-presentation-v1";
  cards: { evidenceId: string; name: string; summary: string; retrievedAt: string; sourceUrl?: string; imageUrl?: string; provider?: string; reviewAverage?: number }[];
}
export function parsePublicAccommodationPresentation(input: unknown): PublicAccommodationPresentation {
  const value = input as PublicAccommodationPresentation;
  if (!record(input) || Object.keys(input).some(key => !["version", "cards"].includes(key)) ||
      value.version !== "public-accommodation-presentation-v1" || !Array.isArray(value.cards) || value.cards.length < 1 || value.cards.length > 10) throw Error("Invalid accommodation presentation");
  const ids = new Set<string>();
  for (const card of value.cards) {
    if (!record(card) || Object.keys(card).some(key => !["evidenceId", "name", "summary", "retrievedAt", "sourceUrl", "imageUrl", "provider", "reviewAverage"].includes(key)) ||
        !text(card.evidenceId, 240) || ids.has(card.evidenceId) || !text(card.name, 160) || !text(card.summary, 1000) ||
        typeof card.retrievedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/u.test(card.retrievedAt) || !Number.isFinite(Date.parse(card.retrievedAt)) ||
        card.sourceUrl !== undefined && (typeof card.sourceUrl !== "string" || !publicPlaceSourceUrl(card.sourceUrl))) throw Error("Invalid accommodation card");
    if (card.imageUrl !== undefined && (typeof card.imageUrl !== "string" || card.imageUrl.length > 2048 || !publicPlaceSourceUrl(card.imageUrl)?.startsWith("https://")) ||
        card.provider !== undefined && !text(card.provider, 120) ||
        card.reviewAverage !== undefined && (typeof card.reviewAverage !== "number" || !Number.isFinite(card.reviewAverage) || card.reviewAverage < 0 || card.reviewAverage > 5)) throw Error("Invalid accommodation card");
    ids.add(card.evidenceId);
  }
  return structuredClone(value);
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function text(value: unknown, max: number): value is string { return typeof value === "string" && !!value.trim() && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value); }
