import { authorizeLegacyAgentRequest } from "./legacy-agent-ingress.js";
import { createCognitoAccessTokenVerifier } from "./adapters/cognito-access-token-verifier.js";
import { createAgentApplication } from "./composition-root.js";
import { createAgentApiHandler } from "./handler.js";
import { createTripApiHandler } from "./trip-handler.js";
import { createTripSharingHandler } from "./trip-sharing-handler.js";
import { createNotificationHandler } from "./notification-handler.js";
import { createInTripContextHandler } from "./in-trip-context-handler.js";
import type { LambdaHttpEvent, LambdaContext } from "./contracts/http.js";

const application = createAgentApplication();

const agentHandler = createAgentApiHandler(application, {
  authorize: authorizeLegacyAgentRequest(createCognitoAccessTokenVerifier({
    userPoolId: process.env.COGNITO_USER_POOL_ID ?? "",
    clientId: process.env.COGNITO_CLIENT_ID ?? "",
  })),
  log: (event, fields) => console.log(JSON.stringify({ event, ...fields })),
});

// Fail closed. CloudFront/IAM origin protection is NOT an authenticated end-user principal.
// Do not install a Trip application/verifier here until real auth and #389 writer gates are reviewed.
const tripHandler = createTripApiHandler();
const sharingHandler = createTripSharingHandler();
const notificationHandler = createNotificationHandler(); // Same auth gate; no fake principal or Notification store grants.
export const handler = (event: LambdaHttpEvent, context?: LambdaContext) =>
  event.rawPath === "/api/trips/sharing/v1" ? sharingHandler(event, context) :
  event.rawPath === "/api/trips/in-trip/v1" ? createInTripContextHandler()(event) :
  event.rawPath === "/api/trips/notifications/v1" ? notificationHandler(event) : event.rawPath === "/api/trips" || event.rawPath?.startsWith("/api/trips/")
    ? tripHandler(event, context) : agentHandler(event, context);
