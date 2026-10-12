import type { ItineraryItem, Trip } from "@raiquora/trip/trip";
import { datedSearchSelectionTarget, matchingRailSelectionTargets } from "@raiquora/trip/search-selection-target";
import type { CanonicalPlanCandidateDraft } from "./plan-candidate-retention.js";

/** Retain without changing the Trip. A focused item or uniquely matching whole
 * selected journey precedes unresolved slots. Adoption alone replaces the item. */
export function searchSelectionDraft(items: readonly ItineraryItem[], trip: Trip, focusedItemId?: string): CanonicalPlanCandidateDraft | undefined {
  if (!items.length || items.length > 10 || items.some(item => item.type !== items[0]!.type)) return undefined;
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
  const choices = !focused && !reselection && slots.length > 1 && !dated
    ? slots.filter(slot => datedSearchSelectionTarget(items, [slot], trip)) : [];
  if (!focused && !reselection && slots.length > 1 && !dated && !choices.length) return undefined;
  if (choices.length * items.length > 20) return undefined;
  const target = focused ?? reselection ?? dated ?? slots[0];
  // A first dated selection establishes ordered days from that verified span.
  const first = items[0]!.schedule;
  const zone = first.type === "fixed" ? first.startAt.timeZone : first.type === "day" ? first.timeZone : undefined;
  const start = first.type === "fixed" ? first.startAt.at.slice(0, 10) : first.type === "day" ? first.date : undefined;
  const end = first.type === "day" ? first.endDate ?? start : start;
  const count = start && end ? Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1 : 0;
  const dayOrder = !trip.items.length && !trip.timeline && zone && count > 0 && count <= 90
    ? Array.from({ length: count }, (_, index) => `day-${index + 1}`) : [];
  return { selectionItems: structuredClone(items), coverage: { coveredScopes: ["取得済み候補の旅程への採用"], omittedScopes: [], complete: true },
    variants: (choices.length ? choices : [target]).flatMap((choice, choiceIndex) => items.map((item, index) => {
      const logicalDayId = choice?.logicalDayId ?? (choice?.schedule.type === "relative" ? choice.schedule.dayId : dayOrder[0]);
      return { id: choices.length ? `target-${choiceIndex + 1}-option-${index + 1}` : `option-${index + 1}`,
      label: choices.length ? `${item.title}（「${choice!.title}」を差し替え）` : item.title, timeline: { dayOrder, itemOrder: ["selection-item"] },
      items: [{ componentId: "selection-item", kind: item.type, title: item.title, schedule: structuredClone(item.schedule),
        ...(logicalDayId ? { logicalDayId } : {}),
        sourceCandidateRef: item.id, evidenceRefs: [], ...(choice ? { baseItemId: choice.id } : {
          placement: trip.items.length ? { afterRef: focusedItemId ?? trip.items.at(-1)!.id } : { atBeginning: true as const } }) }],
      assumptionRefs: [], assessmentRefs: [], changedComponentIds: ["selection-item"], removedBaseItemIds: [],
      retainedBaseItemIds: trip.items.filter(value => value.id !== choice?.id).map(value => value.id) }; })) };
}
