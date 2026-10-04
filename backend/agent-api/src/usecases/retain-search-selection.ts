import type { ItineraryItem, Trip } from "@raiquora/trip/trip";
import type { CanonicalPlanCandidateDraft } from "./plan-candidate-retention.js";

/** Retain only server-verified items. Existing unresolved slots need a unique or
 * explicitly focused target; alternatives never overwrite a different item. */
export function searchSelectionDraft(items: readonly ItineraryItem[], trip: Trip, focusedItemId?: string): CanonicalPlanCandidateDraft | undefined {
  if (!items.length || items.length > 5 || items.some(item => item.type !== items[0]!.type)) return undefined;
  if (focusedItemId && !trip.items.some(item => item.id === focusedItemId)) return undefined;
  const kind = items[0]!.type;
  const slots = trip.items.filter(item => item.type === kind &&
    (item.type === "transport" && item.detail.status === "unresolved" || item.type === "stay" && item.selection.status === "unselected"));
  const focused = focusedItemId ? trip.items.find(item => item.id === focusedItemId && item.type === kind) : undefined;
  if (!focused && slots.length > 1) return undefined;
  const target = focused ?? slots[0];
  return { selectionItems: structuredClone(items), coverage: { coveredScopes: ["取得済み候補の旅程への採用"], omittedScopes: [], complete: true },
    variants: items.map((item, index) => ({ id: `option-${index + 1}`, label: item.title, timeline: { dayOrder: [], itemOrder: ["selection-item"] },
      items: [{ componentId: "selection-item", kind: item.type, title: item.title, schedule: structuredClone(item.schedule),
        sourceCandidateRef: item.id, evidenceRefs: [], ...(target ? { baseItemId: target.id } : {
          placement: trip.items.length ? { afterRef: focusedItemId ?? trip.items.at(-1)!.id } : { atBeginning: true as const } }) }],
      assumptionRefs: [], assessmentRefs: [], changedComponentIds: ["selection-item"], removedBaseItemIds: [],
      retainedBaseItemIds: trip.items.filter(value => value.id !== target?.id).map(value => value.id) })) };
}
