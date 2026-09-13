import { randomUUID } from "node:crypto";
import { checklistExactKey, checklistIdentifier, previewChecklistProposal, validateChecklistItems, type TripChecklistItem, type ChecklistProposal } from "@raiquora/trip/trip-checklist";
import { validateChecklistCommand, editChecklistItem, type ChecklistCommand } from "@raiquora/trip/checklist-edit";
import { TripResourceError } from "../contracts/trip-api.js";
import { requireTripPrincipal, type TripPrincipal, type TripRepository } from "../ports/trip-repository.js";
import type { ReservationReader } from "../ports/reservation-repository.js";
import type { ChecklistRepository, ChecklistWrite } from "../ports/checklist-repository.js";

/** Internal authenticated host only. Confirmation is out-of-band, never an LLM/body capability. */
export class ChecklistApplication {
  constructor(private readonly trips: Pick<TripRepository, "get">, private readonly checklist: ChecklistRepository,
    private readonly reservations: ReservationReader, private readonly newId: () => string = randomUUID) {}
  private async trip(principal: TripPrincipal, tripId: string) {
    requireTripPrincipal(principal);
    try { checklistIdentifier(tripId); } catch { throw new TripResourceError("invalid-input"); }
    const trip = await this.trips.get(principal, tripId);
    if (!trip) throw new TripResourceError("not-found");
    return trip;
  }
  async list(principal: TripPrincipal | undefined, tripId: string) {
    requireTripPrincipal(principal); await this.trip(principal, tripId);
    const read = await this.checklist.read(principal, tripId);
    validateChecklistItems(tripId, read.items);
    return structuredClone(read.items);
  }
  async preview(principal: TripPrincipal | undefined, proposal: ChecklistProposal) {
    requireTripPrincipal(principal);
    try { validateChecklistCommand({ operation: "confirm-suggestions", proposal }); } catch { throw new TripResourceError("invalid-input"); }
    return previewChecklistProposal(proposal, await this.list(principal, proposal.tripId));
  }
  async execute(principal: TripPrincipal | undefined, value: unknown, authority?: { confirmed: boolean }) {
    requireTripPrincipal(principal);
    let command = value as ChecklistCommand;
    try { validateChecklistCommand(command); } catch { throw new TripResourceError("invalid-input"); }
    command = structuredClone(command);
    if (authority?.confirmed !== true) throw new TripResourceError("confirmation-required");
    const tripId = command.operation === "confirm-suggestions" ? command.proposal.tripId : command.tripId;
    const trip = await this.trip(principal, tripId), read = await this.checklist.read(principal, tripId);
    validateChecklistItems(tripId, read.items);
    const writes: ChecklistWrite[] = [];
    if (command.operation === "update") {
      const before = read.items.find((i) => i.id === command.id);
      if (!before) throw new TripResourceError("not-found");
      if (before.revision !== command.baseRevision) throw new TripResourceError("conflict");
      try { writes.push({ item: editChecklistItem(before, command), baseRevision: before.revision }); }
      catch { throw new TripResourceError("invalid-input"); }
    } else {
      const details = command.operation === "add" ? [command.details] : previewChecklistProposal(command.proposal, read.items).suggestions;
      const keys = new Set(read.items.map(checklistExactKey));
      for (const detail of details) {
        if (keys.has(checklistExactKey(detail))) continue;
        const item: TripChecklistItem = { ...detail, id: command.operation === "add" ? command.id : this.newId(), tripId,
          schemaVersion: 1, revision: 0, status: "open", source: command.operation === "add" ? "user" : "model", archived: false };
        if (read.items.some((i) => i.id === item.id)) throw new TripResourceError("conflict");
        writes.push({ item }); keys.add(checklistExactKey(detail));
      }
    }
    // Only newly assigned links must resolve. Existing dangling links survive status/archive edits.
    let facts: Awaited<ReturnType<ReservationReader["facts"]>> | undefined;
    for (const { item } of writes) {
      const before = read.items.find((i) => i.id === item.id);
      if (item.relatedItineraryItemId && item.relatedItineraryItemId !== before?.relatedItineraryItemId && !trip.items.some((i) => i.id === item.relatedItineraryItemId)) throw new TripResourceError("invalid-input");
      if (item.relatedReservationId && item.relatedReservationId !== before?.relatedReservationId) {
        facts ??= await this.reservations.facts(principal, tripId);
        if (!facts.some((r) => r.reservationId === item.relatedReservationId)) throw new TripResourceError("invalid-input");
      }
    }
    if (writes.length) {
      const ids = new Set(writes.map((w) => w.item.id));
      const next = [...read.items.filter((i) => !ids.has(i.id)), ...writes.map((w) => w.item)];
      validateChecklistItems(tripId, next);
      if (new Set(next.map(checklistExactKey)).size !== next.length) throw new TripResourceError("conflict");
      await this.checklist.commit(principal, tripId, read.version, writes);
    }
    return { changed: writes.map((w) => structuredClone(w.item)), skipped: command.operation === "confirm-suggestions" ? command.proposal.suggestions.length - writes.length : writes.length ? 0 : 1 };
  }
}
