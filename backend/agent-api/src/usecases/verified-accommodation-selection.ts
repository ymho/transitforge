import type { AccommodationOffering } from "@raiquora/trip/travel-candidate";
import { selectAccommodation, type AccommodationSelectionEvidence } from "@raiquora/trip/select-accommodation";
import { projectStaySchedule } from "@raiquora/trip/itinerary-schedule";
import type { ItineraryItem } from "@raiquora/trip/trip";
import type { Evidence } from "@raiquora/agent/evidence-model";
import type { PublicAccommodationPresentation } from "@raiquora/agent/public-accommodation-presentation";
import { publicPlaceSourceUrl } from "@raiquora/agent/public-place-presentation";

/** The same proven facility/product/retention boundary as screen selection.
 * An Offering alone or a model-declared permission never authorizes persistence. */
export function verifiedAccommodationSelectionItems(offerings: readonly AccommodationOffering[],
  proofs: readonly AccommodationSelectionEvidence[], retrievedAt: string): ItineraryItem[] {
  return offerings.slice(0, 5).flatMap(offering => {
    const matches = proofs.filter(proof => proof.provider === offering.provider && proof.providerItemId === offering.providerItemId);
    if (matches.length !== 1 || !matches[0]!.storageAllowed) return [];
    const accommodation = selectAccommodation(offering, matches[0]!, retrievedAt);
    return [{ id: `hotel:${offering.providerItemId}`, title: offering.name, type: "stay" as const,
      schedule: projectStaySchedule(offering.checkInDate, offering.checkOutDate, accommodation.place.timeZone),
      selection: { status: "selected" as const, accommodation } }];
  });
}

/** Same-invocation association to an exact, actually published observation.
 * Repeated hotel searches cannot swap dates or silently rebind a card's ID. */
export class VerifiedAccommodationSelections {
  private readonly entries = new Map<string, { item: ItineraryItem; card: PublicAccommodationPresentation["cards"][number] } | null>();
  record(offerings: readonly AccommodationOffering[], proofs: readonly AccommodationSelectionEvidence[], evidence: readonly Evidence[]): void {
    for (const observation of evidence) {
      if (observation.observation?.predicate !== "accommodation_search_result") continue;
      const matches = offerings.filter(offering => offering.provider === observation.facts.provider && offering.providerItemId === observation.facts.providerItemId);
      if (matches.length !== 1 || observation.facts.name !== matches[0]!.name ||
          observation.observation.validDuring?.from !== matches[0]!.checkInDate || observation.observation.validDuring?.until !== matches[0]!.checkOutDate ||
          typeof observation.facts.accommodationSummary !== "string") { this.entries.set(observation.id, null); continue; }
      let item: ItineraryItem | undefined;
      try { item = verifiedAccommodationSelectionItems(matches, proofs, observation.observation.retrievedAt)[0]; }
      catch { /* Invalid provenance remains display-only. */ }
      if (!item) { this.entries.set(observation.id, null); continue; }
      item = { ...item, id: observation.id };
      const reference = observation.references.find(ref => ref.sourceType === "external-source");
      const sourceUrl = reference ? publicPlaceSourceUrl(reference.sourceRef) : undefined;
      const entry = { item, card: { evidenceId: observation.id, name: matches[0]!.name.slice(0, 160), summary: observation.facts.accommodationSummary,
        retrievedAt: observation.observation.retrievedAt, ...(sourceUrl ? { sourceUrl } : {}) } };
      const previous = this.entries.get(observation.id);
      this.entries.set(observation.id, previous === null || previous && JSON.stringify(previous) !== JSON.stringify(entry) ? null : structuredClone(entry));
    }
  }
  itemsFor(presentation: PublicAccommodationPresentation | undefined): ItineraryItem[] {
    return presentation?.cards.flatMap(card => {
      const entry = this.entries.get(card.evidenceId);
      return entry && entry.card.name === card.name && entry.card.summary === card.summary &&
        entry.card.retrievedAt === card.retrievedAt && entry.card.sourceUrl === card.sourceUrl ? [structuredClone(entry.item)] : [];
    }) ?? [];
  }
}
