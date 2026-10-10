import { applyTripProposal, validateTrip, TripRevisionConflict, type Trip, type TripPatch, type TripUpdateProposal } from "@raiquora/trip/trip";
import { TripWriteRejected } from "./server-trip-client";
import type { TravelCandidate } from "@raiquora/trip/travel-candidate";
import type { TravelCandidateAssessment } from "@raiquora/trip/travel-candidate-assessment";
import { validateTravelCandidateAssessment } from "@raiquora/trip/validate-candidate-assessment";
import { proposeCandidateSelection, type CandidateSelectionPort, type CandidateSelectionRequest } from "./select-trip-candidate";
import type { TripLoadState } from "./server-trip-client";
import { validateReservationFact, bookedReservationChanges, reservationChangeKey, type ReservationFact } from "@raiquora/trip/reservation";
import { evaluateTripFeasibility, type TripFeasibilityFacts } from "@raiquora/trip/trip-feasibility";
import { requireFeasibleTrip, requestsReady } from "@raiquora/trip/trip-ready";
import { projectTripReadiness } from "@raiquora/trip/trip-readiness";
import { createChecklistWorkspaceController, type ChecklistWorkspacePort } from "./checklist-workspace-controller";
import { assertItineraryEditingAllowed, previewInTripReplan, type InTripReplanTargets } from "@raiquora/trip/in-trip-replan";
import { parsePublicPlanPresentation, type PublicPlanPresentation } from "@raiquora/agent/public-plan-presentation";

export interface TripProposalConfirmation { reservationChangeKey?: string; replanConfirmationKey?: string; }

/** A read/preview host, not a Repository. No default writer, legacy conversion or dual write. */
export interface TripWorkspaceSource {
  /** Opaque session generation for dropping proposals across account changes. */
  sessionVersion?(): number | undefined;
  checklist?: ChecklistWorkspacePort;
  getLoadState?(): TripLoadState;
  subscribe?(listener: () => void): () => void;
  retry?(): Promise<void>;
  getCurrentTrip(): Trip | undefined;
  getRole?(): import("@raiquora/trip/trip-sharing").TripRole | undefined;
  /** undefined means not fetched/unavailable, not an empty set of bookings. */
  getReservationFacts?(): readonly ReservationFact[] | undefined;
  /** Already acquired runtime observations; no fetch or model call implied by rendering. */
  getFeasibilityExternalFacts?(): TripFeasibilityFacts["external"];
  getReplanTargets?(): InTripReplanTargets | undefined;
  getCandidates?(): readonly { candidate: TravelCandidate; assessment?: TravelCandidateAssessment }[];
  candidateSelection?: { taskId: string; port: CandidateSelectionPort };
  /** Explicit in-memory confirmation may be supplied by a host; candidate proposals need revalidation there. */
  confirmProposal?(proposal: TripUpdateProposal, confirmation?: TripProposalConfirmation): Promise<void>;
  confirmationPersistence?: "server";
}
export function createTripWorkspaceController(initialSessionId: string, now: () => Date = () => new Date()) {
  let sessionId = initialSessionId;
  const sessions = new Map<string, { source: TripWorkspaceSource; itemId?: string; proposal?: TripUpdateProposal; base?: string; confirming?: boolean; plan?: PublicPlanPresentation }>();
  const subscriptions = new Map<string, () => void>();
  const listeners = new Set<() => void>();
  const savedListeners = new Set<(proposal: TripUpdateProposal) => void>();
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
  const preview = (proposal: TripUpdateProposal, notify = true) => {
    const trip = current(), s = state();
    if (!trip || !s) throw new Error("Current Trip unavailable");
    applyTripProposal(trip, proposal);
    assertItineraryEditingAllowed(trip, proposal);
    if (trip.lifecycleState === "in_trip") replan(proposal);
    s.proposal = structuredClone(proposal); s.base = JSON.stringify(trip);
    if (notify) publish();
  };
  const feasibilityInput = (trip: Trip): TripFeasibilityFacts => ({ tripId: trip.id, tripRevision: trip.revision,
    reservations: reservations(), external: state()?.source.getFeasibilityExternalFacts?.() });
  const replan = (proposal = state()?.proposal) => {
    const trip = current(), s = state();
    if (!trip || !s || !proposal || trip.lifecycleState !== "in_trip" ||
        !proposal.patches.some((p) => ["add", "replace", "remove", "move"].includes(p.type))) return undefined;
    return previewInTripReplan(trip, proposal, { now: now(), reservations: reservations(),
      external: s.source.getFeasibilityExternalFacts?.(), targets: s.source.getReplanTargets?.() ??
        (s.itemId ? { tripId: trip.id, baseRevision: trip.revision, itemIds: [s.itemId] } : undefined) });
  };
  const checklist = createChecklistWorkspaceController({ trip: current, port: () => state()?.source.checklist, session: () => sessionId, publish });
  return {
    checklist,
    replan,
    readiness() {
      const trip = current();
      if (!trip) return undefined;
      const facts = feasibilityInput(trip);
      return projectTripReadiness(trip, evaluateTripFeasibility(trip, facts, now().toISOString()), facts.reservations, checklist.items());
    },
    current,
    plan() {
      const plan = state()?.plan, trip = current();
      return plan && trip && plan.target?.tripId === trip.id && plan.target.baseTripRevision === trip.revision ? structuredClone(plan) : undefined;
    },
    presentPlan(input: PublicPlanPresentation) {
      const plan = parsePublicPlanPresentation(input), trip = current(), s = state();
      if (!trip || !s || plan.target?.tripId !== trip.id || plan.target.baseTripRevision !== trip.revision) throw new TripRevisionConflict();
      s.plan = plan; publish();
    },
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
      checklist.forget(id);
      const trip = source.getCurrentTrip();
      if (trip) validateTrip(trip);
      sessions.set(id, { source });
      subscriptions.get(id)?.();
      let authVersion = source.sessionVersion?.();
      const unsubscribe = source.subscribe?.(() => {
        const s = sessions.get(id), latest = source.getCurrentTrip();
        const nextAuthVersion = source.sessionVersion?.();
        if (s && nextAuthVersion !== authVersion) {
          delete s.proposal; delete s.base; delete s.itemId; delete s.plan; checklist.forget(id);
        }
        authVersion = nextAuthVersion;
        if (s?.proposal && latest && latest.revision !== s.proposal.baseRevision) { delete s.proposal; delete s.base; }
        if (id === sessionId) publish();
      });
      if (unsubscribe) subscriptions.set(id, unsubscribe); else subscriptions.delete(id);
      if (id === sessionId) publish();
    },
    activateSession(id: string) { sessionId = id; publish(); },
    refresh: publish,
    subscribeSaved(listener: (proposal: TripUpdateProposal) => void) { savedListeners.add(listener); return () => { savedListeners.delete(listener); }; },
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
    async applyConfirmed(proposal: TripUpdateProposal, confirmation?: TripProposalConfirmation) {
      const s = state();
      if (!s || s.proposal || s.confirming) throw new Error("別の変更を処理中です。先に完了してください。");
      preview(proposal, false);
      const shown = s.proposal;
      try { await this.confirm(confirmation); }
      finally { if (s.proposal === shown) { delete s.proposal; delete s.base; } publish(); }
    },
    propose(summary: string, patches: readonly TripPatch[]) {
      const trip = current();
      if (!trip) throw new Error("Current Trip unavailable");
      preview({ tripId: trip.id, baseRevision: trip.revision, summary, patches });
    },
    dismiss() { const s = state(); if (s) { delete s.proposal; delete s.base; } publish(); },
    async saveConditions(proposal: TripUpdateProposal) {
      const selectedSession = sessionId, s = state(), trip = current();
      if (!s || !trip || s.confirming || !s.source.confirmProposal) throw new Error("旅程を保存できません");
      if (s.source.getRole?.() === "viewer") throw new TripWriteRejected("この旅程は閲覧専用です");
      if (proposal.tripId !== trip.id || proposal.baseRevision !== trip.revision) throw new TripRevisionConflict();
      if (!proposal.patches.length || proposal.patches.some(patch => patch.type !== "request")) throw new Error("条件以外の変更は保存できません");
      applyTripProposal(trip, proposal);
      assertItineraryEditingAllowed(trip, proposal);
      s.confirming = true;
      try { await s.source.confirmProposal(structuredClone(proposal)); if (sessionId === selectedSession) for (const listener of savedListeners) listener(proposal); }
      finally { s.confirming = false; publish(); }
    },
    canConfirm() { return state()?.source.getRole?.() !== "viewer" && !!state()?.source.confirmProposal; },
    async confirm(confirmation?: TripProposalConfirmation) {
      const s = state(), trip = current(), selectedSession = sessionId;
      if (s?.source.getRole?.() === "viewer") throw new TripWriteRejected("この旅程は閲覧専用です");
      if (!s?.proposal || s.confirming || !s.source.confirmProposal || !trip) throw new Error("旅程が変わったか、確認処理中です。変更案を確認し直してください。");
      if (trip.revision !== s.proposal.baseRevision || JSON.stringify(trip) !== s.base) {
        delete s.proposal; delete s.base; publish();
        throw new TripRevisionConflict();
      }
      const shown = s.proposal;
      const proposed = applyTripProposal(trip, shown);
      assertItineraryEditingAllowed(trip, shown);
      const replanned = replan(shown);
      if (replanned?.confirmationKey && confirmation?.replanConfirmationKey !== replanned.confirmationKey) {
        throw new Error("固定予定・予約・必須条件への影響を明示確認してください。予約自体は変更しません。");
      }
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
      if (sessionId === selectedSession) { publish(); for (const listener of savedListeners) listener(shown); }
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
