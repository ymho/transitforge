import { projectPublicJourneyPresentation, type PublicJourneyPresentation } from "@raiquora/agent/public-journey-presentation";
import { createHash } from "node:crypto";
import { verifiedJourneySelectionItems as selectVerifiedJourneyItems } from "@raiquora/trip/verified-journey-search-selection";
import type { JourneySearchResponse } from "@raiquora/journey/journey-search-service";
import type { ItineraryItem } from "@raiquora/trip/trip";

/** Decode the SAME immutable normalized input used by search. Realtime-adjusted
 * display times never become the adopted scheduled itinerary. No model data. */
export function verifiedJourneySelectionItems(result: JourneySearchResponse, index: Record<string, unknown>, retrievedAt: string): ItineraryItem[] {
  return selectVerifiedJourneyItems(result, index, retrievedAt, createHash("sha256").update(JSON.stringify(index)).digest("hex"));
}

/** Invocation-local association uses the complete shown leg snapshot, never route
 * names or ordinals alone. Conflicting provenance for identical display is refused. */
export class VerifiedJourneySelections {
  private readonly entries = new Map<string, ItineraryItem | null>();
  record(result: JourneySearchResponse, index: Record<string, unknown>, retrievedAt: string): void {
    const items = verifiedJourneySelectionItems(result, index, retrievedAt);
    this.recordItems(result, items);
  }
  recordItems(result: JourneySearchResponse, items: ItineraryItem[]): void {
    const presentation = projectPublicJourneyPresentation(result);
    for (const journey of presentation?.journeys ?? []) {
      const item = items.find(item => item.id === journey.id)!;
      if (!item) continue;
      const key = this.key(presentation!, journey);
      const previous = this.entries.get(key);
      const provenance = (value: ItineraryItem) => value.type === "transport" && value.detail.status === "selected" && value.detail.mode === "rail"
        ? JSON.stringify([value.detail.journey.provenance.timetableInputs, value.detail.journey.provenance.transferPace]) : undefined;
      if (previous === null || previous && provenance(previous) !== provenance(item)) this.entries.set(key, null);
      else this.entries.set(key, structuredClone(item));
    }
  }
  itemsFor(presentation: PublicJourneyPresentation | undefined): ItineraryItem[] {
    return presentation?.journeys.flatMap((journey, index) => {
      const item = this.entries.get(this.key(presentation, journey));
      return item ? [{ ...structuredClone(item), title: `経路${index + 1}: ${presentation.originStation}→${presentation.destinationStation}` }] : [];
    }) ?? [];
  }
  private key(presentation: PublicJourneyPresentation, journey: PublicJourneyPresentation["journeys"][number]): string {
    return JSON.stringify([presentation.serviceDate, presentation.originStation, presentation.destinationStation, journey]);
  }
}
