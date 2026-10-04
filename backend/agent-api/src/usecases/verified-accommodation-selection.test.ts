import { expect, it } from "vitest";
import type { AccommodationOffering } from "@raiquora/trip/travel-candidate";
import type { PublicAccommodationPresentation } from "@raiquora/agent/public-accommodation-presentation";
import { externalTravelEvidence } from "@raiquora/agent/external-travel-evidence";
import { VerifiedAccommodationSelections } from "./verified-accommodation-selection.js";
import { rakutenAccommodationSelectionEvidence } from "../adapters/rakuten-accommodation-selection.js";

const at = "2026-10-04T00:00:00Z";
const hotel: AccommodationOffering = { kind: "accommodation", provider: "rakuten-travel", providerItemId: "42", name: "検証用ホテル",
  checkInDate: "2026-10-04", checkOutDate: "2026-10-05", bookingUrl: "https://example.org/hotel/42" };
const observe = (offering = hotel, toolCallId = "a") => externalTravelEvidence({ accommodations: [offering] }, {
  executionId: "test", toolCallId, toolName: "search_accommodations", queryFingerprint: "query", retrievedAt: at });
function cards(evidence: ReturnType<typeof observe>): PublicAccommodationPresentation {
  return { version: "public-accommodation-presentation-v1", cards: evidence.map(item => ({ evidenceId: item.id,
    name: item.facts.name as string, summary: item.facts.accommodationSummary as string, retrievedAt: at, sourceUrl: hotel.bookingUrl })) };
}
it("keeps separate observation identities and dates for repeated facility searches, refusing substituted display and conflicting bindings", () => {
  const selections = new VerifiedAccommodationSelections(), first = observe();
  const later = { ...hotel, checkInDate: "2026-10-05", checkOutDate: "2026-10-06" }, second = observe(later, "b");
  selections.record([hotel], [rakutenAccommodationSelectionEvidence(hotel, at)!], first);
  selections.record([later], [rakutenAccommodationSelectionEvidence(later, at)!], second);
  expect(selections.itemsFor(cards(first))[0]).toMatchObject({ selection: { accommodation: { checkInDate: "2026-10-04", checkOutDate: "2026-10-05" } } });
  expect(selections.itemsFor(cards(second))[0]).toMatchObject({ selection: { accommodation: { checkInDate: "2026-10-05", checkOutDate: "2026-10-06" } } });
  const tampered = cards(first); tampered.cards[0]!.name = "他のホテル";
  expect(selections.itemsFor(tampered)).toEqual([]);
  const item = selections.itemsFor(cards(first))[0]!; (item as { title: string }).title = "changed clone";
  expect(selections.itemsFor(cards(first))[0]!.title).toBe(hotel.name);
  selections.record([later], [rakutenAccommodationSelectionEvidence(later, at)!], first);
  expect(selections.itemsFor(cards(first))).toEqual([]);
  expect(selections.itemsFor(cards(second))).toHaveLength(1);
});
it("refuses duplicate results, generic product IDs, model-supplied permissions and unsupported service namespaces", () => {
  for (const provider of ["travel-provider", "unknown", "manual"]) {
    const value = { ...hotel, provider };
    expect(rakutenAccommodationSelectionEvidence(value, at)).toBeUndefined();
    const selections = new VerifiedAccommodationSelections(), evidence = observe(value);
    selections.record([value], [], evidence); expect(selections.itemsFor(cards(evidence))).toEqual([]);
  }
  for (const providerItemId of ["", "0", "-1", "plan-42", "042", "1.2", "9007199254740992"]) {
    expect(rakutenAccommodationSelectionEvidence({ ...hotel, providerItemId }, at)).toBeUndefined();
  }
  const proof = rakutenAccommodationSelectionEvidence(hotel, at)!, evidence = observe();
  const duplicates = new VerifiedAccommodationSelections(); duplicates.record([hotel, hotel], [proof], evidence);
  expect(duplicates.itemsFor(cards(evidence))).toEqual([]);
  const disallowed = new VerifiedAccommodationSelections(); disallowed.record([hotel], [{ ...proof, storageAllowed: false }], evidence);
  expect(disallowed.itemsFor(cards(evidence))).toEqual([]);
});
