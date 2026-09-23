import { createHash } from "node:crypto";
import { proposePlanAdoption, type DraftPlanItem } from "@raiquora/trip/itinerary-candidates";
import type { ItineraryItem } from "@raiquora/trip/trip";
import { conversationIdentifier, TripResourceError, tripIdentifier } from "../contracts/trip-api.js";
import type { ItineraryCandidateRepository } from "../ports/itinerary-candidate-repository.js";
import type { CandidateAdoptionReceiptRepository, CandidateAdoptionResult, CandidateAdoptionPreviewReceipt } from "../ports/itinerary-candidate-repository.js";
import { requireTripPrincipal, type TripPrincipal, type TripRepository } from "../ports/trip-repository.js";
import type { TripApplication } from "./trip-application.js";

export interface CandidateAdoptionRequest {
  operation: "preview" | "confirm";
  conversationId: string;
  candidateSetId: string;
  candidateSetRevision: number;
  variantId: string;
  tripId: string;
  baseTripRevision: number;
  mutationId: string;
}
export interface CandidateAdoptionAuthority { confirmationKey: string }

/** Converts a retained typed candidate to the existing Proposal/CAS path. Markdown is never an input. */
export class PlanCandidateAdoptionApplication {
  constructor(private readonly candidates: ItineraryCandidateRepository, private readonly trips: TripRepository,
    private readonly receipts: CandidateAdoptionReceiptRepository,
    private readonly tripApplication: Pick<TripApplication, "execute">,
    private readonly trustedFactory: (draft: DraftPlanItem, context: { candidateSetId: string; variantId: string }) => ItineraryItem,
    private readonly now: () => Date = () => new Date()) {}

  async execute(principal: TripPrincipal | undefined, value: CandidateAdoptionRequest, authority?: CandidateAdoptionAuthority): Promise<CandidateAdoptionResult> {
    requireTripPrincipal(principal); validateRequest(value);
    const retained = await this.receipts.getPreview(principal, value.conversationId, value.mutationId);
    if (retained) return this.executeRetained(principal, value, retained, authority);
    if (value.operation === "confirm") throw new TripResourceError("confirmation-required");
    const candidateSet = await this.candidates.get(principal, value.conversationId, value.candidateSetId, value.candidateSetRevision);
    if (!candidateSet) throw new TripResourceError("not-found");
    const trip = await this.trips.get(principal, value.tripId);
    if (!trip) throw new TripResourceError("not-found");
    if (trip.revision !== value.baseTripRevision || candidateSet.contextRef.conversationId !== value.conversationId ||
        candidateSet.contextRef.tripId !== value.tripId || candidateSet.contextRef.baseTripRevision !== value.baseTripRevision) throw new TripResourceError("conflict");
    let adoption: ReturnType<typeof proposePlanAdoption>;
    try { adoption = proposePlanAdoption({ candidateSet, variantId: value.variantId, currentTrip: trip,
      requestFingerprint: candidateSet.contextRef.requestFingerprint, now: this.now().toISOString(),
      trustedFactory: draft => this.trustedFactory(draft, { candidateSetId: candidateSet.id, variantId: value.variantId }) }); }
    catch { throw new TripResourceError("conflict"); }
    const confirmationKey = candidateConfirmationKey(value, adoption.proposal);
    const receipt = await this.receipts.putPreview(principal, { mutationId: value.mutationId, conversationId: value.conversationId,
      candidateSetId: value.candidateSetId, candidateSetRevision: value.candidateSetRevision, variantId: value.variantId, tripId: value.tripId,
      baseTripRevision: value.baseTripRevision, confirmationKey, proposal: adoption.proposal, componentMap: adoption.componentMap });
    return this.executeRetained(principal, value, receipt, authority);
  }
  private async executeRetained(principal: TripPrincipal, value: CandidateAdoptionRequest, receipt: CandidateAdoptionPreviewReceipt,
    authority?: CandidateAdoptionAuthority): Promise<CandidateAdoptionResult> {
    if (receipt.conversationId !== value.conversationId || receipt.candidateSetId !== value.candidateSetId || receipt.candidateSetRevision !== value.candidateSetRevision ||
        receipt.variantId !== value.variantId || receipt.tripId !== value.tripId || receipt.baseTripRevision !== value.baseTripRevision) throw new TripResourceError("mutation-reused");
    const preview = { proposal: structuredClone(receipt.proposal), componentMap: structuredClone(receipt.componentMap),
      changes: { added: receipt.proposal.patches.filter(({ type }) => type === "add").length,
        replaced: receipt.proposal.patches.filter(({ type }) => type === "replace").length,
        removed: receipt.proposal.patches.filter(({ type }) => type === "remove").length } };
    if (value.operation === "preview") return { status: "confirmation-required", confirmationKey: receipt.confirmationKey, preview };
    if (!authority || !constantEqual(authority.confirmationKey, receipt.confirmationKey)) throw new TripResourceError("confirmation-required");
    const result = await this.tripApplication.execute(principal, { version: "trip-api-v1", operation: "mutate", tripId: value.tripId,
      baseRevision: value.baseTripRevision, mutationId: value.mutationId, proposal: receipt.proposal });
    const saved = await this.trips.get(principal, value.tripId);
    const returned = (result as { trip?: unknown }).trip;
    if (!saved || saved.revision < value.baseTripRevision + 1 || !returned || typeof returned !== "object") throw new TripResourceError("unavailable");
    return { status: "saved", trip: structuredClone(returned) as typeof saved, revision: (returned as typeof saved).revision, mutationId: value.mutationId };
  }
}

function validateRequest(value: CandidateAdoptionRequest): void {
  if (!value || typeof value !== "object" || Object.keys(value).some((key) => !["operation", "conversationId", "candidateSetId", "candidateSetRevision", "variantId", "tripId", "baseTripRevision", "mutationId"].includes(key)) ||
      !["preview", "confirm"].includes(value.operation)) throw new TripResourceError("invalid-input");
  conversationIdentifier(value.conversationId); tripIdentifier(value.tripId); tripIdentifier(value.mutationId);
  for (const field of [value.candidateSetId, value.variantId]) if (typeof field !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u.test(field)) throw new TripResourceError("invalid-input");
  if (![value.candidateSetRevision, value.baseTripRevision].every((item) => Number.isSafeInteger(item) && item >= 0)) throw new TripResourceError("invalid-input");
}
function candidateConfirmationKey(request: CandidateAdoptionRequest, proposal: unknown): string {
  return createHash("sha256").update(JSON.stringify([request.conversationId, request.candidateSetId, request.candidateSetRevision, request.variantId,
    request.tripId, request.baseTripRevision, proposal])).digest("hex");
}
function constantEqual(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/u.test(left) || left.length !== right.length) return false;
  let difference = 0; for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
