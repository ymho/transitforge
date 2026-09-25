import { createCognitoAccessTokenVerifier } from "./adapters/cognito-access-token-verifier.js";
import { createHttpPrincipalResolver } from "./http-auth-composition.js";
import { createAuthorizedTripApplications } from "./trip-composition-root.js";
import { createTripApiHandler } from "./trip-handler.js";
import { jsonResponse, type LambdaContext, type LambdaHttpEvent } from "./contracts/http.js";
import type { AccessTokenVerifier } from "./ports/access-token-verifier.js";
import { DynamoDbItineraryCandidateRepository } from "./adapters/dynamodb-itinerary-candidate-repository.js";
import { PlanCandidateAdoptionApplication } from "./usecases/plan-candidate-adoption.js";
import { createHash } from "node:crypto";
import type { DraftPlanItem } from "@raiquora/trip/itinerary-candidates";
import type { ItineraryItem } from "@raiquora/trip/trip";

/** Dedicated public host for the owner-scoped Trip writer. It exposes no sharing or worker routes. */
export function createTripApiPublicHandler(options: {
  enabled: boolean;
  auth: { userPoolId: string; clientId: string; requiredScopes: readonly string[] };
  tripTable: string;
  stateTable: string;
  verifier?: AccessTokenVerifier;
}) {
  if (!options.enabled) return async (_event: LambdaHttpEvent, _context?: LambdaContext) => jsonResponse(503, { error: "unavailable" });
  if (!options.tripTable || !options.stateTable) throw new Error("Missing Trip API configuration");
  const authenticate = createHttpPrincipalResolver(options.verifier ?? createCognitoAccessTokenVerifier(options.auth), options.auth.requiredScopes);
  const applications = createAuthorizedTripApplications(options.tripTable, options.stateTable);
  const candidates = new DynamoDbItineraryCandidateRepository(options.tripTable);
  const adoption = new PlanCandidateAdoptionApplication(candidates, applications.repository, candidates, applications.trips,
    (draft, context) => trustedCandidateItem(draft, context.candidateSetId, context.variantId));
  const handler = createTripApiHandler(Object.assign(applications.trips, { executeAdoption: adoption.execute.bind(adoption) }), { authenticate });
  return (event: LambdaHttpEvent, context?: LambdaContext) => {
    if (event.rawPath && event.path && event.rawPath !== event.path) return Promise.resolve(jsonResponse(404, { error: "not-found" }));
    return (event.rawPath ?? event.path) === "/api/trips/v1"
      ? handler(event, context)
      : Promise.resolve(jsonResponse(404, { error: "not-found" }));
  };
}

function trustedCandidateItem(draft: DraftPlanItem, candidateSetId: string, variantId: string): ItineraryItem {
  const id = `candidate:${createHash("sha256").update(JSON.stringify([candidateSetId, variantId, draft.componentId])).digest("hex").slice(0, 32)}`;
  const base = { id: draft.baseItemId ?? id, title: draft.title, schedule: structuredClone(draft.schedule), ...(draft.logicalDayId ? { logicalDayId: draft.logicalDayId } : {}) };
  if (draft.kind === "transport") return { ...base, type: "transport", detail: { status: "unresolved" } };
  if (draft.kind === "stay") return { ...base, type: "stay", selection: { status: "unselected" } };
  return { ...base, type: "activity", category: "other" };
}
