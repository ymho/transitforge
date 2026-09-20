import { ApiAuthenticationError } from "../auth/api-authentication-error";
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

/** A Conversation only carries a server Trip reference; browser storage is never consulted. */
export function createReferencedTripSource(reference: { tripId?: string },
  client: Pick<ServerTripClient, "get" | "getRole" | "sessionVersion" | "subscribeSessionChange">, writer?: ServerTripWriter): TripWorkspaceSource | undefined {
  if (!reference.tripId) return undefined;
  const source = createServerTripWorkspaceSource(reference.tripId, client, writer);
  void source.refresh();
  return source;
}

/** Memory is a fetched read view, never a local writer/cache fallback. Preview cannot save. */
export function createServerTripWorkspaceSource(tripId: string, client: Pick<ServerTripClient, "get" | "getRole" | "sessionVersion" | "subscribeSessionChange">, writer?: ServerTripWriter,
  reservationReader?: ReservationReadClient, getExternalFacts?: () => TripFeasibilityFacts["external"],
  preparation?: { reader: ChecklistReadClient; writer?: ChecklistWriteClient }): TripWorkspaceSource & { refresh(): Promise<void> } {
  let current: Trip | undefined, loadState: TripLoadState = "loading", generation = 0;
  let reservations: ReservationFact[] | undefined;
  let checklist: TripChecklistItem[] | undefined, checklistSending = false;
  let pending: TripMutationRequest | undefined, sending = false, confirming = false;
  const listeners = new Set<() => void>();
  let sessionVersion = client.sessionVersion?.();
  const checkSession = () => {
    const next = client.sessionVersion?.();
    if (next === sessionVersion) return;
    sessionVersion = next; ++generation; pending = undefined;
    current = undefined; reservations = undefined; checklist = undefined; loadState = "unavailable";
  };
  const publish = () => { for (const listener of listeners) listener(); };
  const refresh = async () => {
    checkSession();
    const request = ++generation;
    current = undefined; reservations = undefined; checklist = undefined; loadState = "loading"; publish();
    try {
      const trip = await client.get(tripId);
      checkSession();
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
    checkSession();
    if (!writer || !pending || sending || client.getRole?.(tripId) === "viewer") throw new Error("変更の確認または送信が必要です");
    sending = true;
    const sent = pending, sentSession = sessionVersion;
    try {
      const result = await writer.mutate(structuredClone(sent));
      checkSession();
      if (sentSession !== sessionVersion) throw new ApiAuthenticationError("session-changed");
      validateTrip(result);
      if (result.id !== tripId || result.revision !== sent.baseRevision + 1) throw new Error("Invalid mutation response");
      pending = undefined;
      await refresh(); // Receipt may describe an older successful revision: GET the current Trip.
    } catch (error) {
      if (error instanceof TripRevisionConflict || error instanceof TripWriteRejected || error instanceof ApiAuthenticationError) { pending = undefined; await refresh(); }
      else { ++generation; current = undefined; loadState = "unavailable"; publish(); }
      throw error;
    } finally { sending = false; }
  };
  return { sessionVersion: () => { checkSession(); return sessionVersion; }, confirmationPersistence: writer ? "server" : undefined,
    getRole: () => client.getRole?.(tripId),
    ...(preparation ? { checklist: { getItems: () => { checkSession(); return current && checklist ? structuredClone(checklist) : undefined; },
      ...(preparation.writer ? { async write(command: ChecklistCommand) {
        if (!current || checklistSending || !checklist) throw new Error("準備リストを再取得してください");
        const commandTrip = command.operation === "confirm-suggestions" ? command.proposal.tripId : command.tripId;
        if (commandTrip !== tripId) throw new Error("対象の旅行が異なります");
        checklistSending = true;
        try { await preparation.writer!.execute(structuredClone(command)); }
        finally { checklistSending = false; await refresh(); } // Even uncertain writes must re-read, no blind retry.
      } } : {}) } } : {}),
    ...(writer ? { async confirmProposal(proposal: TripUpdateProposal, confirmation?: TripProposalConfirmation) {
      checkSession();
      const confirmationSession = sessionVersion;
      if (pending || sending || confirming) throw new Error("前回の保存結果を再確認してください");
      confirming = true;
      try {
        const latest = await client.get(tripId).catch((error: unknown) => {
          ++generation; current = undefined; loadState = "unavailable"; publish(); throw error;
        });
        if (!latest || latest.id !== tripId) { await refresh(); throw new TripWriteRejected("旅程を取得できません"); }
        if (client.getRole?.(tripId) === "viewer") { await refresh(); throw new TripWriteRejected("この旅程は閲覧専用です"); }
        try {
          const proposed = applyTripProposal(latest, proposal);
          if (requestsReady(proposal)) requireFeasibleTrip(proposed, {
            tripId, tripRevision: proposed.revision, reservations: await reservationReader?.list(tripId), external: getExternalFacts?.(),
          }, new Date().toISOString());
        }
        catch (error) { await refresh(); throw error; }
        await writer.validateConfirmation(structuredClone(latest), structuredClone(proposal), confirmation);
        checkSession();
        if (confirmationSession !== sessionVersion) throw new ApiAuthenticationError("session-changed");
        const mutationId = writer.newMutationId();
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(mutationId)) throw new Error("Invalid mutation ID");
        pending = { tripId, baseRevision: proposal.baseRevision, mutationId, proposal: structuredClone(proposal) };
        await sendPending();
      } finally { confirming = false; }
    } } : {}), getLoadState: () => { checkSession(); return loadState; }, getCurrentTrip: () => { checkSession(); return current ? structuredClone(current) : undefined; },
    getReservationFacts: () => { checkSession(); return current && reservations ? structuredClone(reservations) : undefined; },
    getFeasibilityExternalFacts: getExternalFacts,
    subscribe(listener) {
      listeners.add(listener);
      const unsubscribe = client.subscribeSessionChange?.(() => { checkSession(); listener(); });
      return () => { unsubscribe?.(); listeners.delete(listener); };
    }, refresh,
    retry: async () => { checkSession(); if (pending) await sendPending(); else await refresh(); } };
}
