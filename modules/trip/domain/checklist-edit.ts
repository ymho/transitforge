import { exactKeys } from "./snapshot-validation";
import { checklistIdentifier, checklistDetailKeys, validateChecklistDetails, validateChecklistItem, validateChecklistProposal,
  type ChecklistDetails, type ChecklistProposal, type TripChecklistItem } from "./trip-checklist";

export type ChecklistChanges = Partial<Pick<ChecklistDetails, "category" | "title"> & Pick<TripChecklistItem, "status" | "archived">> & {
  relatedItineraryItemId?: string | null;
  relatedReservationId?: string | null;
  dueDate?: string | null;
};
export type ChecklistCommand =
  | { operation: "add"; tripId: string; id: string; details: ChecklistDetails }
  | { operation: "update"; tripId: string; id: string; baseRevision: number; changes: ChecklistChanges }
  | { operation: "confirm-suggestions"; proposal: ChecklistProposal };

export function validateChecklistCommand(command: ChecklistCommand): void {
  if (!command || typeof command !== "object") throw new Error("Invalid checklist command");
  if (command.operation === "confirm-suggestions") {
    exactKeys(command, ["operation", "proposal"]); validateChecklistProposal(command.proposal); return;
  }
  checklistIdentifier(command.tripId); checklistIdentifier(command.id);
  if (command.operation === "add") {
    exactKeys(command, ["operation", "tripId", "id", "details"]); validateChecklistDetails(command.details); return;
  }
  if (command.operation !== "update") throw new Error("Invalid checklist operation");
  exactKeys(command, ["operation", "tripId", "id", "baseRevision", "changes"]);
  if (!Number.isSafeInteger(command.baseRevision) || command.baseRevision < 0 || command.baseRevision >= Number.MAX_SAFE_INTEGER) throw new Error("Invalid checklist revision");
  exactKeys(command.changes, [...checklistDetailKeys, "status", "archived"]);
  if (!Object.keys(command.changes).length) throw new Error("Empty checklist edit");
}
/** Explicit user edits only. Null unlinks; omitted fields preserve the old value. */
export function editChecklistItem(before: TripChecklistItem, command: Extract<ChecklistCommand, { operation: "update" }>): TripChecklistItem {
  validateChecklistItem(before); validateChecklistCommand(command);
  if (command.tripId !== before.tripId || command.id !== before.id || command.baseRevision !== before.revision) throw new Error("Checklist revision conflict");
  const next = { ...before, ...command.changes, revision: before.revision + 1 };
  for (const key of ["relatedItineraryItemId", "relatedReservationId", "dueDate"] as const) if (next[key] === null) delete next[key];
  validateChecklistItem(next as TripChecklistItem);
  return next as TripChecklistItem;
}
