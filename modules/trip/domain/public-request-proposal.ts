import { type TripUpdateProposal } from "./trip";
import { validateTripRequest } from "./trip-request";
import { exactKeys } from "./snapshot-validation";
import { parseIntentProposalBinding } from "./intent-proposal-binding";

export type PublicRequestProposal = TripUpdateProposal & {
  readonly patches: readonly [Extract<TripUpdateProposal["patches"][number], { type: "request" }>];
};
/** Public data only, bounded below SSE/Dynamo limits; no raw tool envelopes. */
export function parsePublicRequestProposal(value: unknown): PublicRequestProposal {
  const raw = JSON.stringify(value);
  if (!raw || new TextEncoder().encode(raw).length > 16_384) throw new Error("Proposal exceeds public limit");
  const p = JSON.parse(raw) as PublicRequestProposal;
  exactKeys(p, ["tripId", "baseRevision", "summary", "patches", "intentBinding"]);
  if (typeof p.tripId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(p.tripId) ||
      !Number.isSafeInteger(p.baseRevision) || p.baseRevision < 0 || typeof p.summary !== "string" || !p.summary.trim() || p.summary.length > 500 ||
      !Array.isArray(p.patches) || p.patches.length !== 1 || p.patches[0]?.type !== "request") throw new Error("Invalid public proposal");
  const patch = p.patches[0];
  exactKeys(patch, ["type", "request"]);
  // Request-only public proposals support trip-wide conditions. Item editing has a separate contract.
  validateTripRequest(patch.request, []);
  // Match the authenticated Trip API aggregate bound. Semantic attributes and
  // scoped alternatives must not be dropped by an older public-only cap.
  if (patch.request.constraints.length > 100 || patch.request.assumptions.length > 100) throw new Error("Too many conditions");
  if (p.intentBinding !== undefined) parseIntentProposalBinding(p.intentBinding);
  return p;
}
