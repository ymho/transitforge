import { applyTripProposal, validateTrip, TripRevisionConflict, type Trip, type TripUpdateProposal } from "./trip";
import { positionAt } from "./trip-temporal";
import { effectiveTripConstraints } from "./trip-request";
import { validateReservationFact, type ReservationFact } from "./reservation";
import { evaluateTripFeasibility, type TripFeasibilityFacts } from "./trip-feasibility";

/** Request-local authority supplied by the interaction host, never a Tool argument.
 * UI selection is an explicit target; model-selected IDs are only proposed patches. */
export interface InTripReplanTargets {
  tripId: string;
  baseRevision: number;
  itemIds: readonly string[];
}
export interface InTripReplanInput {
  now: Date;
  reservations: readonly ReservationFact[] | undefined;
  targets?: InTripReplanTargets;
  external?: TripFeasibilityFacts["external"];
}
export type ReplanProtection = "past" | "outside-scope" | "booked" | "fixed" | "hard-constraint" | "reservation-unconfirmed";
export interface InTripReplanScope {
  tripId: string; baseRevision: number; evaluatedAt: string;
  immutableProtectedItemIds: string[]; confirmationProtectedItemIds: string[]; mutableItemIds: string[];
  currentItemIds: string[]; nextItemIds: string[];
  reasons: { itemId: string; codes: ReplanProtection[] }[];
}

export function assertItineraryEditingAllowed(trip: Trip, proposal: TripUpdateProposal): void {
  if ((trip.lifecycleState === "cancelled" || trip.lifecycleState === "completed") &&
      proposal.patches.some((p) => ["add", "replace", "remove", "move"].includes(p.type))) throw new Error("終了・中止した旅行は再計画できません");
}

/** Shared pure policy over the existing schedule calculation, not an intent router.
 * Default scope is the current and next two adopted items, not the whole remainder.
 * Fixed appointments are conservatively important. Trip-wide hard constraints protect all items. */
export function calculateInTripReplanScope(trip: Trip, input: InTripReplanInput): InTripReplanScope {
  validateTrip(trip);
  if (trip.lifecycleState !== "in_trip" || !Number.isFinite(input.now.getTime())) throw new Error("旅行中の最新旅程と実時刻が必要です");
  input.reservations?.forEach(validateReservationFact);
  const targets = input.targets;
  if (targets && (targets.tripId !== trip.id || targets.baseRevision !== trip.revision)) throw new TripRevisionConflict();
  if (targets && (targets.itemIds.length > 8 || new Set(targets.itemIds).size !== targets.itemIds.length ||
    targets.itemIds.some((id) => !trip.items.some((item) => item.id === id)))) throw new Error("変更対象を確認してください");
  const positions = trip.items.map((item) => ({ id: item.id, position: positionAt(item.schedule, input.now) }));
  const currentItemIds = positions.filter((p) => p.position === "current").map((p) => p.id);
  const nextItemIds = positions.filter((p) => p.position === "upcoming").slice(0, 2).map((p) => p.id);
  const requested = new Set(targets?.itemIds ?? [...currentItemIds.slice(0, 2), ...nextItemIds]);
  const result: InTripReplanScope = { tripId: trip.id, baseRevision: trip.revision, evaluatedAt: input.now.toISOString(),
    immutableProtectedItemIds: [], confirmationProtectedItemIds: [], mutableItemIds: [], currentItemIds, nextItemIds, reasons: [] };
  for (const item of trip.items) {
    const codes: ReplanProtection[] = [];
    if (positionAt(item.schedule, input.now) === "past") codes.push("past");
    if (!requested.has(item.id)) codes.push("outside-scope");
    if (input.reservations === undefined) codes.push("reservation-unconfirmed");
    if (input.reservations?.some((r) => r.status === "booked" && r.itineraryItemId === item.id)) codes.push("booked");
    if (item.schedule.type === "fixed") codes.push("fixed");
    if (effectiveTripConstraints(trip.request, item.id).some((c) => c.strength === "hard")) codes.push("hard-constraint");
    const protectedItem = codes.some((c) => c === "booked" || c === "fixed" || c === "hard-constraint");
    if (protectedItem) result.confirmationProtectedItemIds.push(item.id);
    if (codes.some((c) => c === "past" || c === "outside-scope" || c === "reservation-unconfirmed") ||
        (protectedItem && !targets?.itemIds.includes(item.id))) result.immutableProtectedItemIds.push(item.id);
    else result.mutableItemIds.push(item.id);
    result.reasons.push({ itemId: item.id, codes });
  }
  return result;
}

/** Shared by Agent preview, UI preview/confirm, and server prepare-before-CAS.
 * Returns a read-only preview; the existing Proposal remains the sole mutation contract. */
export function previewInTripReplan(trip: Trip, proposal: TripUpdateProposal, input: InTripReplanInput) {
  // Validate revision before scope/feasibility; never rebase.
  const proposed = applyTripProposal(trip, proposal);
  const scope = calculateInTripReplanScope(trip, input);
  const mutable = new Set(scope.mutableItemIds), added = new Set<string>(), changed = new Set<string>();
  let order = trip.items.map((i) => i.id);
  const requireMutable = (id: string) => {
    if (!mutable.has(id) && !added.has(id)) throw new Error("過去・対象外・保護された予定は変更できません。変更対象を画面で明示してください。");
  };
  for (const patch of proposal.patches) {
    if (patch.type === "planning") {
      if (patch.state !== "itinerary_draft" && patch.state !== "itinerary_refinement") throw new Error("再計画で準備完了を自動認定しません");
      continue;
    }
    // Preserve request/hard constraints/assumptions and lifecycle; these are separate user operations.
    if (patch.type === "request" || patch.type === "lifecycle" || patch.type === "adoption") throw new Error("残り旅程の変更で旅行条件・状態を書き換えられません");
    if (patch.type === "add" || patch.type === "move") {
      const anchor = patch.afterId ?? (patch.type === "add" ? order.at(-1) : undefined);
      if (!anchor) throw new Error("変更可能な予定の直後へ配置してください");
      requireMutable(anchor);
      if (patch.type === "move") {
        requireMutable(patch.itemId);
        const from = order.indexOf(patch.itemId), to = order.indexOf(anchor);
        order.slice(Math.min(from, to), Math.max(from, to) + 1).forEach(requireMutable);
        order = order.filter((id) => id !== patch.itemId);
      }
      const id = patch.type === "add" ? patch.item.id : patch.itemId;
      order.splice(order.indexOf(anchor) + 1, 0, id);
      if (patch.type === "add") added.add(id);
    } else {
      requireMutable(patch.itemId);
      if (patch.type === "remove") order = order.filter((id) => id !== patch.itemId);
    }
    const id = patch.type === "add" ? patch.item.id : patch.itemId;
    changed.add(id);
    if ((patch.type === "add" || patch.type === "replace") && positionAt(patch.item.schedule, input.now) === "past") throw new Error("過去へ予定を追加・移動できません");
  }
  const protectedChanges = scope.reasons.filter((r) => changed.has(r.itemId) && scope.confirmationProtectedItemIds.includes(r.itemId));
  const feasibility = evaluateTripFeasibility(proposed, { tripId: trip.id, tripRevision: trip.revision,
    reservations: input.reservations, external: input.external }, input.now.toISOString());
  // Includes exact Proposal and the complete validated reservation version set; no clock so confirm can recheck at a later instant.
  const confirmationKey = protectedChanges.length ? JSON.stringify({ proposal, protectedChanges,
    reservations: input.reservations?.map((r) => ({ id: r.reservationId, revision: r.revision, status: r.status, itemId: r.itineraryItemId }))
      .sort((a, b) => a.id.localeCompare(b.id)) }) : undefined;
  return { scope, proposed, feasibility, protectedChanges, confirmationKey,
    keptItemIds: trip.items.filter((i) => !changed.has(i.id)).map((i) => i.id), changedItemIds: [...changed] };
}

/** Only this bounded, non-authorizing projection is sent to the model. */
export function replanScopeContext(scope: InTripReplanScope) {
  const visible = new Set([...scope.mutableItemIds, ...scope.currentItemIds, ...scope.nextItemIds].slice(0, 12));
  return { tripId: scope.tripId, baseRevision: scope.baseRevision, evaluatedAt: scope.evaluatedAt,
    mutableItemIds: scope.mutableItemIds.slice(0, 8), confirmationProtectedItemIds: scope.confirmationProtectedItemIds.filter((id) => visible.has(id)),
    reasons: scope.reasons.filter((r) => visible.has(r.itemId)),
    omitted: scope.reasons.filter((r) => !visible.has(r.itemId)).length,
    policy: "未掲載・過去・対象外は変更不可。保護対象は画面で明示選択してから提案し、適用前に別途確認する。予定位置は実際の現在地・乗車ではない。既存Proposalのみ、保存・予約変更はしない。" };
}
