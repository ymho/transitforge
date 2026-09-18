import { validateTrip, applyTripProposal, TripRevisionConflict, type Trip, type TripUpdateProposal } from "@raiquora/trip/trip";
import type { TripWorkspaceSource, TripProposalConfirmation } from "./trip-workspace-controller";
import type { ServerTripClient, TripLoadState } from "./server-trip-client";
import { TripWriteRejected, type TripMutationRequest } from "./server-trip-client";
import { validateReservationFact, type ReservationFact } from "@raiquora/trip/reservation";
import type { ReservationReadClient } from "./reservation-reader";
import { requireFeasibleTrip, requestsReady } from "@raiquora/trip/trip-ready";
import type { TripFeasibilityFacts } from "@raiquora/trip/trip-feasibility";
import { validateChecklistItems, type TripChecklistItem } from "@raiquora/trip/trip-checklist";
import type { ChecklistReadClient, ChecklistWriteClient } from "./checklist-reader";
import type { ChecklistCommand } from "@raiquora/trip/checklist-edit";

/** Inject only from a reviewed authenticated host, never from model/wire capability flags.
 * validateConfirmation re-resolves candidates/evidence and verifies explicit user authority.
 */
export interface ServerTripWriter {
  mutate(mutation: TripMutationRequest): Promise<Trip>;
  newMutationId(): string;
  validateConfirmation(current: Trip, proposal: TripUpdateProposal, confirmation?: TripProposalConfirmation): Promise<void>;
}

/** Restores source ownership before any legacy reader/writer can be installed on reload. */
export function createReferencedTripSource(reference: { tripId?: string; tripSourceState?: "migration-pending" | "server-v2" },
  client: Pick<ServerTripClient, "get">): TripWorkspaceSource | undefined {
  if (!reference.tripId && !reference.tripSourceState) return undefined;
  if (reference.tripSourceState === "migration-pending" || !reference.tripId) return {
    sourceState: reference.tripSourceState ?? "server-v2", getCurrentTrip: () => undefined, getLoadState: () => "unavailable",
  };
  const source = createServerTripWorkspaceSource(reference.tripId, client);
  void source.refresh();
  return source; // No writer: public authenticated transport is still unavailable.
}

/** Memory is a fetched read view, never a local writer/cache fallback. Preview cannot save. */
export function createServerTripWorkspaceSource(tripId: string, client: Pick<ServerTripClient, "get">, writer?: ServerTripWriter,
  reservationReader?: ReservationReadClient, getExternalFacts?: () => TripFeasibilityFacts["external"],
  preparation?: { reader: ChecklistReadClient; writer?: ChecklistWriteClient }): TripWorkspaceSource & { refresh(): Promise<void> } {
  let current: Trip | undefined, loadState: TripLoadState = "loading", generation = 0;
  let reservations: ReservationFact[] | undefined;
  let checklist: TripChecklistItem[] | undefined, checklistSending = false;
  let pending: TripMutationRequest | undefined, sending = false, confirming = false;
  const listeners = new Set<() => void>();
  const publish = () => { for (const listener of listeners) listener(); };
  const refresh = async () => {
    const request = ++generation;
    current = undefined; reservations = undefined; checklist = undefined; loadState = "loading"; publish();
    try {
      const trip = await client.get(tripId);
      if (request !== generation) return;
      if (!trip || trip.id !== tripId) throw new Error("Trip unavailable");
      validateTrip(trip); current = structuredClone(trip); loadState = "loaded";
      if (reservationReader) {
        try {
          const facts = await reservationReader.list(tripId); facts.forEach(validateReservationFact);
          if (request === generation) reservations = structuredClone(facts);
        } catch { if (request === generation) reservations = undefined; }
      }
      if (preparation) {
        try {
          const items = await preparation.reader.list(tripId); validateChecklistItems(tripId, items);
          if (request === generation) checklist = structuredClone(items);
        } catch { if (request === generation) checklist = undefined; }
      }
    } catch { if (request === generation) { current = undefined; loadState = "unavailable"; } }
    if (request === generation) publish();
  };
  const sendPending = async () => {
    if (!writer || !pending || sending) throw new Error("変更の確認または送信が必要です");
    sending = true;
    try {
      const result = await writer.mutate(structuredClone(pending));
      validateTrip(result);
      if (result.id !== tripId || result.revision !== pending.baseRevision + 1) throw new Error("Invalid mutation response");
      pending = undefined;
      await refresh(); // Receipt may describe an older successful revision: GET the current Trip.
    } catch (error) {
      if (error instanceof TripRevisionConflict || error instanceof TripWriteRejected) { pending = undefined; await refresh(); }
      else { ++generation; current = undefined; loadState = "unavailable"; publish(); }
      throw error;
    } finally { sending = false; }
  };
  return { sourceState: "server-v2", confirmationPersistence: writer ? "server" : undefined,
    ...(preparation ? { checklist: { getItems: () => current && checklist ? structuredClone(checklist) : undefined,
      ...(preparation.writer ? { async write(command: ChecklistCommand) {
        if (!current || checklistSending || !checklist) throw new Error("準備リストを再取得してください");
        const commandTrip = command.operation === "confirm-suggestions" ? command.proposal.tripId : command.tripId;
        if (commandTrip !== tripId) throw new Error("対象の旅行が異なります");
        checklistSending = true;
        try { await preparation.writer!.execute(structuredClone(command)); }
        finally { checklistSending = false; await refresh(); } // Even uncertain writes must re-read, no blind retry.
      } } : {}) } } : {}),
    ...(writer ? { async confirmProposal(proposal: TripUpdateProposal, confirmation?: TripProposalConfirmation) {
      if (pending || sending || confirming) throw new Error("前回の保存結果を再確認してください");
      confirming = true;
      try {
        const latest = await client.get(tripId).catch((error: unknown) => {
          ++generation; current = undefined; loadState = "unavailable"; publish(); throw error;
        });
        if (!latest || latest.id !== tripId) { await refresh(); throw new TripWriteRejected("旅程を取得できません"); }
        try {
          const proposed = applyTripProposal(latest, proposal);
          if (requestsReady(proposal)) requireFeasibleTrip(proposed, {
            tripId, tripRevision: proposed.revision, reservations: await reservationReader?.list(tripId), external: getExternalFacts?.(),
          }, new Date().toISOString());
        }
        catch (error) { await refresh(); throw error; }
        await writer.validateConfirmation(structuredClone(latest), structuredClone(proposal), confirmation);
        const mutationId = writer.newMutationId();
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(mutationId)) throw new Error("Invalid mutation ID");
        pending = { tripId, baseRevision: proposal.baseRevision, mutationId, proposal: structuredClone(proposal) };
        await sendPending();
      } finally { confirming = false; }
    } } : {}), getLoadState: () => loadState, getCurrentTrip: () => current ? structuredClone(current) : undefined,
    getReservationFacts: () => current && reservations ? structuredClone(reservations) : undefined,
    getFeasibilityExternalFacts: getExternalFacts,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, refresh,
    retry: async () => { if (pending) await sendPending(); else await refresh(); } };
}
