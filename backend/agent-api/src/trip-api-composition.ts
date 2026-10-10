import { BedrockConsultationScope } from "./adapters/bedrock-consultation-scope.js";
import { createTripSharingHandler } from "./trip-sharing-handler.js";
import { createCognitoAccessTokenVerifier } from "./adapters/cognito-access-token-verifier.js";
import { createHttpPrincipalResolver } from "./http-auth-composition.js";
import { createAuthorizedTripApplications } from "./trip-composition-root.js";
import { createTripApiHandler } from "./trip-handler.js";
import { jsonResponse, type LambdaContext, type LambdaHttpEvent } from "./contracts/http.js";
import type { AccessTokenVerifier } from "./ports/access-token-verifier.js";
import { DynamoDbItineraryCandidateRepository } from "./adapters/dynamodb-itinerary-candidate-repository.js";
import { PlanCandidateAdoptionApplication } from "./usecases/plan-candidate-adoption.js";
import { trustedCandidateItem } from "./usecases/retained-candidate-item.js";

/** Dedicated public host for the owner-scoped Trip writer. It exposes authenticated sharing and official guide operations, never worker routes. */
export function createTripApiPublicHandler(options: {
  enabled: boolean;
  auth: { userPoolId: string; clientId: string; requiredScopes: readonly string[] };
  tripTable: string;
  stateTable: string;
  verifier?: AccessTokenVerifier;
  consultationScope?: import("./ports/consultation-scope.js").ConsultationScope;
  scopeModelId?: string;
}) {
  if (!options.enabled) return async (_event: LambdaHttpEvent, _context?: LambdaContext) => jsonResponse(503, { error: "unavailable" });
  if (!options.tripTable || !options.stateTable) throw new Error("Missing Trip API configuration");
  const authenticate = createHttpPrincipalResolver(options.verifier ?? createCognitoAccessTokenVerifier(options.auth), options.auth.requiredScopes);
  const applications = createAuthorizedTripApplications(options.tripTable, options.stateTable, options.consultationScope ?? new BedrockConsultationScope(options.scopeModelId ?? "jp.amazon.nova-2-lite-v1:0"));
  const sharingHandler = createTripSharingHandler(applications.sharing, { authenticate });
  const candidates = new DynamoDbItineraryCandidateRepository(options.tripTable);
  const adoption = new PlanCandidateAdoptionApplication(candidates, applications.repository, candidates, applications.trips,
    (draft, context) => trustedCandidateItem(draft, context.candidateSetId, context.variantId, context.retainedItem, context.selectedAt));
  const handler = createTripApiHandler(Object.assign(applications.trips, { executeAdoption: adoption.execute.bind(adoption) }), { authenticate });
  return (event: LambdaHttpEvent, context?: LambdaContext) => {
    if (event.rawPath && event.path && event.rawPath !== event.path) return Promise.resolve(jsonResponse(404, { error: "not-found" }));
    if ((event.rawPath ?? event.path) === "/api/trips/sharing/v1") return sharingHandler(event, context);
    return (event.rawPath ?? event.path) === "/api/trips/v1"
      ? handler(event, context)
      : Promise.resolve(jsonResponse(404, { error: "not-found" }));
  };
}
