import { applyTripProposal, validateTrip, TripRevisionConflict, type Trip, type TripPatch, type TripUpdateProposal } from "@raiquora/trip/trip";
import { TripWriteRejected } from "./server-trip-client";
import type { TravelCandidate } from "@raiquora/trip/travel-candidate";
import type { TravelCandidateAssessment } from "@raiquora/trip/travel-candidate-assessment";
import { validateTravelCandidateAssessment } from "@raiquora/trip/validate-candidate-assessment";
import { proposeCandidateSelection, type CandidateSelectionPort, type CandidateSelectionRequest } from "./select-trip-candidate";
import type { TripLoadState, TripSourceState } from "./server-trip-client";
import { validateReservationFact, bookedReservationChanges, reservationChangeKey, type ReservationFact } from "@raiquora/trip/reservation";
import { evaluateTripFeasibility, type TripFeasibilityFacts } from "@raiquora/trip/trip-feasibility";
import { requireFeasibleTrip, requestsReady } from "@raiquora/trip/trip-ready";

/** A read/preview host, not a Repository. No default writer, legacy conversion or dual write. */
export interface TripWorkspaceSource {
  sourceState?: Exclude<TripSourceState, "legacy-only">;
  getLoadState?(): TripLoadState;
  subscribe?(listener: () => void): () => void;
  retry?(): Promise<void>;
  getCurrentTrip(): Trip | undefined;
  /** undefined means not fetched/unavailable, not an empty set of bookings. */
  getReservationFacts?(): readonly ReservationFact[] | undefined;
  /** Already acquired runtime observations; no fetch or model call implied by rendering. */
  getFeasibilityExternalFacts?(): TripFeasibilityFacts["external"];
  getCandidates?(): readonly { candidate: TravelCandidate; assessment?: TravelCandidateAssessment }[];
  candidateSelection?: { taskId: string; port: CandidateSelectionPort };
  /** Explicit in-memory confirmation may be supplied by a host; candidate proposals need revalidation there. */
  confirmProposal?(proposal: TripUpdateProposal, confirmation?: { reservationChangeKey: string }): Promise<void>;
  confirmationPersistence?: "server";
}
export function createTripWorkspaceController(initialSessionId: string, now: () => Date = () => new Date()) {
  let sessionId = initialSessionId;
  const sessions = new Map<string, { source: TripWorkspaceSource; itemId?: string; proposal?: TripUpdateProposal; base?: string; confirming?: boolean }>();
  const subscriptions = new Map<string, () => void>();
  const listeners = new Set<() => void>();
  const state = () => sessions.get(sessionId);
  const current = () => {
    const trip = state()?.source.getCurrentTrip();
    if (trip) validateTrip(trip);
    return trip;
  };
  const publish = () => { for (const listener of listeners) listener(); };
  const reservations = () => {
    const facts = state()?.source.getReservationFacts?.();
    facts?.forEach(validateReservationFact);
    return facts === undefined ? undefined : structuredClone(facts);
  };
  const preview = (proposal: TripUpdateProposal) => {
    const trip = current(), s = state();
    if (!trip || !s) throw new Error("Current Trip unavailable");
    applyTripProposal(trip, proposal);
    s.proposal = structuredClone(proposal); s.base = JSON.stringify(trip);
    publish();
  };
  const feasibilityInput = (trip: Trip): TripFeasibilityFacts => ({ tripId: trip.id, tripRevision: trip.revision,
    reservations: reservations(), external: state()?.source.getFeasibilityExternalFacts?.() });
  return {
    current,
    reservations,
    feasibility(proposed?: Trip) {
      const trip = proposed ?? current();
      return trip ? evaluateTripFeasibility(trip, feasibilityInput(trip), now().toISOString()) : undefined;
    },
    reservationWarnings() {
      const proposal = state()?.proposal, facts = reservations();
      return proposal && facts ? bookedReservationChanges(proposal, facts) : [];
    },
    blocksLegacy: () => !!state(),
    loadState: () => state()?.source.getLoadState?.() ?? (current() ? "loaded" : "unavailable"),
    source: () => state()?.source,
    sessionId: () => sessionId,
    attach(id: string, source: TripWorkspaceSource) {
      const trip = source.getCurrentTrip();
      if (trip) validateTrip(trip);
      sessions.set(id, { source });
      subscriptions.get(id)?.();
      const unsubscribe = source.subscribe?.(() => {
        const s = sessions.get(id), latest = source.getCurrentTrip();
        if (s?.proposal && latest && latest.revision !== s.proposal.baseRevision) { delete s.proposal; delete s.base; }
        if (id === sessionId) publish();
      });
      if (unsubscribe) subscriptions.set(id, unsubscribe); else subscriptions.delete(id);
      if (id === sessionId) publish();
    },
    activateSession(id: string) { sessionId = id; publish(); },
    refresh: publish,
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
    focus(itemId?: string) {
      const s = state();
      if (!s || (itemId !== undefined && !current()?.items.some((i) => i.id === itemId))) throw new Error("Unknown focused item");
      s.itemId = itemId; publish();
    },
    uiFocus() {
      const itemId = state()?.itemId;
      return itemId && current()?.items.some((i) => i.id === itemId) ? { itemId } : undefined;
    },
    proposal() { return state()?.proposal ? structuredClone(state()!.proposal!) : undefined; },
    preview,
    propose(summary: string, patches: readonly TripPatch[]) {
      const trip = current();
      if (!trip) throw new Error("Current Trip unavailable");
      preview({ tripId: trip.id, baseRevision: trip.revision, summary, patches });
    },
    dismiss() { const s = state(); if (s) { delete s.proposal; delete s.base; } publish(); },
    canConfirm() { return !!state()?.source.confirmProposal; },
    async confirm(confirmation?: { reservationChangeKey: string }) {
      const s = state(), trip = current(), selectedSession = sessionId;
      if (!s?.proposal || s.confirming || !s.source.confirmProposal || !trip) throw new Error("旅程が変わったか、確認処理中です。変更案を確認し直してください。");
      if (trip.revision !== s.proposal.baseRevision || JSON.stringify(trip) !== s.base) {
        delete s.proposal; delete s.base; publish();
        throw new TripRevisionConflict();
      }
      const shown = s.proposal;
      const proposed = applyTripProposal(trip, shown);
      if (requestsReady(shown)) requireFeasibleTrip(proposed, feasibilityInput(proposed), now().toISOString());
      const facts = reservations();
      if (facts && bookedReservationChanges(shown, facts).length && confirmation?.reservationChangeKey !== reservationChangeKey(shown, facts)) {
        throw new Error("予約済みの予定を変更します。予約は変更・取消されません。影響を確認してください。");
      }
      s.confirming = true;
      try { await s.source.confirmProposal(structuredClone(shown), confirmation); }
      catch (error) {
        if (error instanceof TripRevisionConflict || error instanceof TripWriteRejected) {
          if (s.proposal === shown) { delete s.proposal; delete s.base; }
          if (sessionId === selectedSession) publish();
        }
        throw error;
      }
      finally { s.confirming = false; }
      // A delayed confirmation cannot clear another session or a newer proposal.
      if (s.proposal === shown) { delete s.proposal; delete s.base; }
      if (sessionId === selectedSession) publish();
    },
    candidates() {
      return (state()?.source.getCandidates?.() ?? []).map((entry) => {
        if (entry.assessment) {
          validateTravelCandidateAssessment(entry.assessment);
          if (entry.candidate.id !== entry.assessment.candidateId) throw new Error("Assessment belongs to another candidate");
        }
        return entry;
      });
    },
    async selectCandidate(candidateId: string, itemId: string, accommodation?: CandidateSelectionRequest["accommodation"], now = new Date().toISOString()) {
      const s = state(), trip = current(), selectedSession = sessionId;
      if (!s?.source.candidateSelection || !trip) throw new Error("候補の採用はまだ利用できません。会話で相談してください。");
      const selection = s.source.candidateSelection;
      const before = JSON.stringify(trip);
      const proposal = await proposeCandidateSelection(trip, { candidateId, itemId, taskId: selection.taskId,
        ...(accommodation ? { accommodation } : {}) }, selection.port, now);
      if (sessionId !== selectedSession || state() !== s || JSON.stringify(current()) !== before) throw new Error("対象の旅程が変わりました。候補を選び直してください。");
      preview(proposal);
    },
  };
}
export type TripWorkspaceController = ReturnType<typeof createTripWorkspaceController>;
