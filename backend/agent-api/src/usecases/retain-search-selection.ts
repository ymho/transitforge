import type { ItineraryItem, Trip } from "@raiquora/trip/trip";
import { datedSearchSelectionTarget, matchingRailSelectionTargets } from "@raiquora/trip/search-selection-target";
import type { CanonicalPlanCandidateDraft } from "./plan-candidate-retention.js";

/** Retain without changing the Trip. A focused item or uniquely matching whole
 * selected journey precedes unresolved slots. Adoption alone replaces the item. */
export function searchSelectionDraft(items: readonly ItineraryItem[], trip: Trip, focusedItemId?: string): CanonicalPlanCandidateDraft | undefined {
  if (!items.length || items.length > 5 || items.some(item => item.type !== items[0]!.type)) return undefined;
  if (focusedItemId && !trip.items.some(item => item.id === focusedItemId)) return undefined;
  const kind = items[0]!.type;
  const slots = trip.items.filter(item => item.type === kind &&
    (item.type === "transport" && item.detail.status === "unresolved" || item.type === "stay" && item.selection.status === "unselected"));
  const focused = focusedItemId ? trip.items.find(item => item.id === focusedItemId && item.type === kind) : undefined;
  if (focusedItemId && !focused) return undefined;
  const selected = !focused ? matchingRailSelectionTargets(items, trip) : [];
  const reselection = selected.length ? datedSearchSelectionTarget(items, selected, trip) : undefined;
  // An ambiguous matching journey must never fall through to a different slot.
  if (selected.length && !reselection) return undefined;
  // Once a route is adopted, an unmatched search may concern a new journey or
  // just one of its legs. Calendar proximity alone cannot establish that intent.
  if (!focused && !reselection && kind === "transport" && trip.items.some(item =>
    item.type === "transport" && item.detail.status === "selected")) return undefined;
  const dated = !focused && !reselection && slots.length > 1 ? datedSearchSelectionTarget(items, slots, trip) : undefined;
  if (!focused && !reselection && slots.length > 1 && !dated) return undefined;
  const target = focused ?? reselection ?? dated ?? slots[0];
  return { selectionItems: structuredClone(items), coverage: { coveredScopes: ["取得済み候補の旅程への採用"], omittedScopes: [], complete: true },
    variants: items.map((item, index) => ({ id: `option-${index + 1}`, label: item.title, timeline: { dayOrder: [], itemOrder: ["selection-item"] },
      items: [{ componentId: "selection-item", kind: item.type, title: item.title, schedule: structuredClone(item.schedule),
        sourceCandidateRef: item.id, evidenceRefs: [], ...(target ? { baseItemId: target.id } : {
          placement: trip.items.length ? { afterRef: focusedItemId ?? trip.items.at(-1)!.id } : { atBeginning: true as const } }) }],
      assumptionRefs: [], assessmentRefs: [], changedComponentIds: ["selection-item"], removedBaseItemIds: [],
      retainedBaseItemIds: trip.items.filter(value => value.id !== target?.id).map(value => value.id) })) };
}
