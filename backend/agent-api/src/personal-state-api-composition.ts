import { DynamoDbTripRepository } from "./adapters/dynamodb-trip-repository.js";
import { createCognitoAccessTokenVerifier } from "./adapters/cognito-access-token-verifier.js";
import { DynamoDbConversationRepository } from "./adapters/dynamodb-conversation-repository.js";
import { DynamoDbProfileRepository } from "./adapters/dynamodb-profile-repository.js";
import { createHttpPrincipalResolver } from "./http-auth-composition.js";
import { createConversationApiHandler, createProfileApiHandler } from "./server-state-handler.js";
import { ConversationApplication } from "./usecases/conversation-application.js";
import { ProfileApplication } from "./usecases/profile-application.js";
import { jsonResponse, type LambdaHttpEvent, type LambdaContext } from "./contracts/http.js";
import type { AccessTokenVerifier } from "./ports/access-token-verifier.js";
import { DynamoDbItineraryCandidateRepository } from "./adapters/dynamodb-itinerary-candidate-repository.js";
import { createBrowserAgentDiagnosticsHandler } from "./browser-agent-diagnostics-handler.js";
import type { BrowserAgentDiagnostic } from "@raiquora/agent/browser-agent-diagnostic";

/** Production host for personal state and content-free diagnostics. No Trip writers. */
export function createPersonalStateApiHandler(options: {
  enabled: boolean;
  auth: { userPoolId: string; clientId: string; requiredScopes: readonly string[] };
  stateTable: string;
  tripTable: string;
  verifier?: AccessTokenVerifier;
  diagnosticLog?: (report: BrowserAgentDiagnostic) => void;
}) {
  if (!options.enabled) return async (_event: LambdaHttpEvent, _context?: LambdaContext) => jsonResponse(503, { error: "unavailable" });
  if (!options.stateTable || !options.tripTable) throw new Error("Missing personal state API configuration");
  const authenticate = createHttpPrincipalResolver(options.verifier ?? createCognitoAccessTokenVerifier(options.auth), options.auth.requiredScopes);
  const conversations = createConversationApiHandler(new ConversationApplication(new DynamoDbConversationRepository(options.stateTable),
    new DynamoDbItineraryCandidateRepository(options.tripTable), undefined, new DynamoDbTripRepository(options.tripTable)), authenticate);
  const profile = createProfileApiHandler(new ProfileApplication(new DynamoDbProfileRepository(options.stateTable)), authenticate);
  const diagnostics = createBrowserAgentDiagnosticsHandler(authenticate, options.diagnosticLog ??
    (report => console.info(JSON.stringify({ eventSource: "browser_agent_diagnostic", observationSource: "untrusted_browser", receivedAt: new Date().toISOString(), ...report }))));
  return (event: LambdaHttpEvent, context?: LambdaContext) => {
    if (event.rawPath && event.path && event.rawPath !== event.path) return Promise.resolve(jsonResponse(404, { error: "not-found" }));
    switch (event.rawPath ?? event.path) {
      case "/api/conversations/diagnostics/v1": return diagnostics(event, context);
      case "/api/conversations/v1": return conversations(event, context);
      case "/api/profile/v1": return profile(event, context);
      default: return Promise.resolve(jsonResponse(404, { error: "not-found" }));
    }
  };
}
