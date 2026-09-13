import type { TripChecklistItem } from "@raiquora/trip/trip-checklist";
import type { ChecklistCommand } from "@raiquora/trip/checklist-edit";
/** Authenticated host seam. No default HTTP transport or capability derived from model data. */
export interface ChecklistReadClient { list(tripId: string): Promise<TripChecklistItem[]> }
export interface ChecklistWriteClient { execute(command: ChecklistCommand): Promise<void> }
