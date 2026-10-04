import { TripResourceError } from "../../contracts/trip-api.js";
import { createHash } from "node:crypto";
import type { ConversationMessage } from "../../contracts/server-state.js";
import type { Trip } from "@raiquora/trip/trip";
import type { CandidateAdoptionRequest } from "../plan-candidate-adoption.js";
import type { CandidateAdoptionResult } from "../../ports/itinerary-candidate-repository.js";

import { presentedCandidateSelectionSchema, type PresentedCandidateSelection, type CandidateKind, type PresentedCandidateGroup, type PresentedCandidateController, type CandidatePresentation } from "../../contracts/presented-candidate-selection.js";
export { presentedCandidateSelectionSchema, type PresentedCandidateSelection, type PresentedCandidateController, type CandidatePresentation } from "../../contracts/presented-candidate-selection.js";

/** Identifiers and order come from committed public snapshots, never assistant prose.
 * The controller owns side effects; the model only interprets an explicit selection. */
export function createPresentedCandidateController(input: {
  messages: readonly ConversationMessage[]; trip: Trip; conversationId: string; userSequence: number;
  executionId: string; userRequest: string;
  adoptPlan: (request: CandidateAdoptionRequest, authority?: { confirmationKey: string }) => Promise<CandidateAdoptionResult>;
  /** Optional authenticated, verified search-candidate boundary. Missing support is explicit. */
  adoptSearch?: (message: ConversationMessage, kind: Exclude<CandidateKind, "plan">, candidateId: string, mutationId: string) => Promise<{ trip: Trip }>;
  show: (presentation: CandidatePresentation) => void;
}) : PresentedCandidateController {
  const bindings = input.messages.filter(message => message.role === "assistant").flatMap(message => {
    const groups: { group: PresentedCandidateGroup; message: ConversationMessage; presentation: CandidatePresentation }[] = [];
    const add = (kind: CandidateKind, candidates: { candidateId: string; label: string }[], presentation: CandidatePresentation) => {
      if (candidates.length) groups.push({ message, presentation, group: { presentationId: `shown:${message.sequence}:${kind}`, kind,
        candidates: candidates.map((candidate, index) => ({ ...candidate, ordinal: index + 1 })) } });
    };
    const searchIds = new Set([...(message.publicJourneyPresentation?.journeys.map(item => item.id) ?? []), ...(message.publicAccommodationPresentation?.cards.map(item => item.evidenceId) ?? [])]);
    const searchPlan = message.publicPlanPresentation?.candidates.every(candidate => candidate.items.length === 1 && searchIds.has(candidate.items[0]!.sourceRef));
    if (message.publicPlanPresentation && !searchPlan) add("plan", message.publicPlanPresentation.candidates.map(candidate => ({ candidateId: candidate.variantId, label: candidate.label })), { publicPlanPresentation: message.publicPlanPresentation });
    if (message.publicJourneyPresentation) add("journey", message.publicJourneyPresentation.journeys.map(journey => ({ candidateId: journey.id,
      label: `${message.publicJourneyPresentation!.originStation}→${message.publicJourneyPresentation!.destinationStation} ${journey.departureTime}–${journey.arrivalTime}` })), { publicJourneyPresentation: message.publicJourneyPresentation, ...(message.publicPlanPresentation ? { publicPlanPresentation: message.publicPlanPresentation } : {}) });
    if (message.publicAccommodationPresentation) add("accommodation", message.publicAccommodationPresentation.cards.map(card => ({ candidateId: card.evidenceId, label: card.name })), { publicAccommodationPresentation: message.publicAccommodationPresentation, ...(message.publicPlanPresentation ? { publicPlanPresentation: message.publicPlanPresentation } : {}) });
    if (message.publicPlacePresentation) add("place", message.publicPlacePresentation.cards.map(card => ({ candidateId: card.evidenceId, label: card.title })), { publicPlacePresentation: message.publicPlacePresentation });
    return groups;
  }).filter((value, index, all) => !all.slice(index + 1).some(other => other.group.kind === value.group.kind)).slice(-4);
  let selected: PresentedCandidateSelection | undefined;
  let pending: ReturnType<PresentedCandidateController["select"]> | undefined;
  const mutationId = stableSelectionMutation(input.conversationId, input.userSequence);
  return { context: { groups: structuredClone(bindings.map(({ group }) => group)), itineraryItemCount: input.trip.items.length, canSave: bindings.some(binding => !!binding.message.publicPlanPresentation) || !!input.adoptSearch },
    async review(presentationId) {
      const binding = bindings.find(value => value.group.presentationId === presentationId);
      if (!binding) return { status: "missing" };
      input.show(structuredClone(binding.presentation));
      return { status: "shown", group: structuredClone(binding.group) };
    },
    async select(value) {
      const parsed = presentedCandidateSelectionSchema.safeParse(value);
      if (!parsed.success || !input.userRequest.includes(parsed.data.quote)) return { status: "invalid_source" };
      const binding = bindings.find(binding => binding.group.presentationId === value.presentationId);
      if (!binding || !binding.group.candidates.some(candidate => candidate.candidateId === value.candidateId)) return { status: "unknown_candidate" };
      const candidate = binding.group.candidates.find(candidate => candidate.candidateId === value.candidateId)!;
      const reference = parsed.data.reference;
      // Verify the model's chosen identity against the literal CURRENT source.
      // This is reference integrity, not a phrase classifier for user intent.
      if (reference.kind === "sole" ? bindings.length !== 1 || binding.group.candidates.length !== 1 :
          !parsed.data.quote.includes(reference.quote) || (reference.kind === "label"
            ? reference.quote !== candidate.label || binding.group.candidates.filter(item => item.label === candidate.label).length !== 1
            : reference.ordinal !== candidate.ordinal || !/^[0-9０-９]+$/u.test(reference.quote) || Number(reference.quote.normalize("NFKC")) !== candidate.ordinal)) return { status: "invalid_source" };
      // One stable mutation per authenticated user turn. A repeated same choice reuses
      // the pending receipt; a different second choice cannot make another write.
      if (selected) return JSON.stringify(selected) === JSON.stringify(value) ? pending! : { status: "unknown_candidate" };
      selected = structuredClone(value);
      pending = (async () => {
        let saved: Trip;
        const associatedPlan = binding.message.publicPlanPresentation;
        const matches = associatedPlan?.candidates.filter(candidate => candidate.items.length === 1 && candidate.items[0]?.sourceRef === value.candidateId) ?? [];
        const associatedVariant = binding.group.kind === "plan" ? value.candidateId : matches.length === 1 ? matches[0]!.variantId : undefined;
        if (associatedPlan && associatedVariant) {
          const plan = associatedPlan, ref = plan.candidateSetRef;
          if (ref.kind !== "candidate-set-ref" || !plan.target) return { status: "unavailable" as const };
          if (plan.target.tripId !== input.trip.id) return { status: "stale" as const };
          const request: CandidateAdoptionRequest = { operation: "preview", conversationId: input.conversationId,
            candidateSetId: ref.candidateSetId, candidateSetRevision: ref.revision, variantId: associatedVariant,
            tripId: input.trip.id, baseTripRevision: plan.target.baseTripRevision, mutationId };
          const preview = await input.adoptPlan(request);
          if (preview.status !== "confirmation-required") throw new Error("candidate_selection_unavailable");
          const result = await input.adoptPlan({ ...request, operation: "confirm" }, { confirmationKey: preview.confirmationKey });
          if (result.status !== "saved") throw new Error("candidate_selection_unavailable");
          saved = result.trip;
        } else {
          if (!input.adoptSearch || binding.group.kind === "plan") return { status: "unavailable" as const };
          saved = (await input.adoptSearch(binding.message, binding.group.kind, value.candidateId, mutationId)).trip;
        }
        if (saved.id !== input.trip.id || saved.revision < 1) throw new Error("candidate_selection_unavailable");
        return { status: "saved" as const, tripId: saved.id, tripRevision: saved.revision,
          receipt: { id: mutationId, executionId: input.executionId, operation: "save" as const, status: "succeeded" as const } };
      })().catch(error => {
        if (error instanceof TripResourceError && ["conflict", "not-found"].includes(error.code)) return { status: "stale" as const };
        if (error instanceof TripResourceError && ["confirmation-required", "invalid-input"].includes(error.code)) return { status: "unavailable" as const };
        throw error;
      });
      return pending;
    },
  };
}
export function stableSelectionMutation(conversationId: string, userSequence: number): string {
  const hex = createHash("sha256").update(JSON.stringify(["presented-selection-v1", conversationId, userSequence])).digest("hex").slice(0, 32).split("");
  hex[12] = "4"; hex[16] = ((parseInt(hex[16]!, 16) & 3) | 8).toString(16);
  return `${hex.slice(0,8).join("")}-${hex.slice(8,12).join("")}-${hex.slice(12,16).join("")}-${hex.slice(16,20).join("")}-${hex.slice(20).join("")}`;
}
