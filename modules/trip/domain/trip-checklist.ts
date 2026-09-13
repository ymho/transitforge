import type { LocalDate } from "./itinerary-schedule";
import { exactKeys, validDate } from "./snapshot-validation";

export const checklistCategories = ["documents", "connectivity", "money", "clothing", "packing", "tickets", "health", "other"] as const;
export const checklistStatuses = ["open", "done", "not-needed"] as const;
export const checklistSources = ["user", "model", "system-suggestion"] as const;
export interface ChecklistDetails {
  category: typeof checklistCategories[number];
  title: string;
  relatedItineraryItemId?: string;
  relatedReservationId?: string;
  dueDate?: LocalDate;
}
/** Independent resource. No Trip/Reservation state, private notes or provider payload. */
export interface TripChecklistItem extends ChecklistDetails {
  id: string;
  tripId: string;
  schemaVersion: 1;
  revision: number;
  status: typeof checklistStatuses[number];
  source: typeof checklistSources[number];
  archived: boolean;
}
/** Add-only suggestions. Identity, source and open status are assigned after confirmation. */
export interface ChecklistProposal {
  tripId: string;
  suggestions: ChecklistDetails[];
}
export const checklistDetailKeys = ["category", "title", "relatedItineraryItemId", "relatedReservationId", "dueDate"] as const;
export function checklistIdentifier(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value)) throw new Error("Invalid checklist identity");
}
function text(value: unknown, max: number): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error("Invalid checklist text");
}
export function validateChecklistDetails(value: ChecklistDetails): void {
  exactKeys(value, checklistDetailKeys);
  if (!checklistCategories.includes(value.category)) throw new Error("Invalid checklist category");
  text(value.title, 200);
  if (value.relatedItineraryItemId !== undefined) text(value.relatedItineraryItemId, 200);
  if (value.relatedReservationId !== undefined) checklistIdentifier(value.relatedReservationId);
  if (value.dueDate !== undefined && (typeof value.dueDate !== "string" || !validDate(value.dueDate))) throw new Error("Invalid checklist date");
}
export function checklistDetails(item: ChecklistDetails): ChecklistDetails {
  return { category: item.category, title: item.title,
    ...(item.relatedItineraryItemId !== undefined ? { relatedItineraryItemId: item.relatedItineraryItemId } : {}),
    ...(item.relatedReservationId !== undefined ? { relatedReservationId: item.relatedReservationId } : {}),
    ...(item.dueDate !== undefined ? { dueDate: item.dueDate } : {}) };
}
export function validateChecklistItem(value: TripChecklistItem): void {
  exactKeys(value, [...checklistDetailKeys, "id", "tripId", "schemaVersion", "revision", "status", "source", "archived"]);
  checklistIdentifier(value.id); checklistIdentifier(value.tripId);
  if (value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
    !checklistStatuses.includes(value.status) || !checklistSources.includes(value.source) || typeof value.archived !== "boolean") throw new Error("Invalid checklist item");
  validateChecklistDetails(checklistDetails(value));
}
export function validateChecklistItems(tripId: string, items: readonly TripChecklistItem[]): void {
  checklistIdentifier(tripId);
  if (!Array.isArray(items) || items.length > 1000) throw new Error("Invalid checklist collection");
  const ids = new Set<string>();
  for (const item of items) {
    validateChecklistItem(item);
    if (item.tripId !== tripId || ids.has(item.id)) throw new Error("Invalid checklist scope");
    ids.add(item.id);
  }
}
export function validateChecklistProposal(value: ChecklistProposal): void {
  exactKeys(value, ["tripId", "suggestions"]); checklistIdentifier(value.tripId);
  if (!Array.isArray(value.suggestions) || !value.suggestions.length || value.suggestions.length > 12) throw new Error("Invalid checklist proposal");
  value.suggestions.forEach(validateChecklistDetails);
}
/** ASCII case fold after NFKC; no language-dependent or semantic matching. */
export function checklistExactKey(value: ChecklistDetails): string {
  validateChecklistDetails(checklistDetails(value));
  return `${value.category}:${value.title.normalize("NFKC").trim().replace(/\s+/gu, " ").replace(/[A-Z]/gu, (c) => c.toLowerCase())}`;
}
export function previewChecklistProposal(proposal: ChecklistProposal, existing: readonly TripChecklistItem[]) {
  validateChecklistProposal(proposal); validateChecklistItems(proposal.tripId, existing);
  // Include archived/user/done/not-needed items: suggestions never resurrect or overwrite history.
  const keys = new Set(existing.map(checklistExactKey)), suggestions: ChecklistDetails[] = [];
  let skipped = 0;
  for (const value of proposal.suggestions) {
    const key = checklistExactKey(value);
    if (keys.has(key)) { skipped++; continue; }
    keys.add(key); suggestions.push(checklistDetails(value));
  }
  return { tripId: proposal.tripId, suggestions, skipped };
}
