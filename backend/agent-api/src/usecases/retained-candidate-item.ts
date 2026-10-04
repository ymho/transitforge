import { createHash } from "node:crypto";
import type { DraftPlanItem } from "@raiquora/trip/itinerary-candidates";
import type { ItineraryItem } from "@raiquora/trip/trip";

export function trustedCandidateItem(draft: DraftPlanItem, candidateSetId: string, variantId: string, retainedItem?: ItineraryItem, selectedAt?: string): ItineraryItem {
  const id = `candidate:${createHash("sha256").update(JSON.stringify([candidateSetId, variantId, draft.componentId])).digest("hex").slice(0, 32)}`;
  const base = { id: draft.baseItemId ?? id, title: draft.title, schedule: structuredClone(draft.schedule), ...(draft.logicalDayId ? { logicalDayId: draft.logicalDayId } : {}) };
  if (draft.sourceCandidateRef) {
    if (!retainedItem || retainedItem.id !== draft.sourceCandidateRef || retainedItem.type !== draft.kind || !selectedAt) throw new Error("Missing retained candidate");
    const item = { ...structuredClone(retainedItem), id: base.id };
    if (item.type === "transport" && item.detail.status === "selected" && item.detail.mode === "rail") item.detail = { ...item.detail, journey: { ...item.detail.journey, selectedAt } };
    if (item.type === "stay" && item.selection.status === "selected") item.selection = { ...item.selection, accommodation: { ...item.selection.accommodation, selectedAt } };
    return item;
  }
  if (draft.kind === "transport") return { ...base, type: "transport", detail: { status: "unresolved" } };
  if (draft.kind === "stay") return { ...base, type: "stay", selection: { status: "unselected" } };
  return { ...base, type: "activity", category: "other" };
}
