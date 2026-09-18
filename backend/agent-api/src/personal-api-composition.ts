import { createCognitoAccessTokenVerifier } from "./adapters/cognito-access-token-verifier.js";
import { createHttpPrincipalResolver } from "./http-auth-composition.js";
import { personalApiPolicies } from "./adapters/api-route-policy.js";
import { createAuthorizedTripApplications } from "./trip-composition-root.js";
import { createInTripContextApplication } from "./in-trip-context-composition-root.js";
import { DynamoDbTripRepository } from "./adapters/dynamodb-trip-repository.js";
import { DynamoDbNotificationRepository } from "./adapters/dynamodb-notification-repository.js";
import { NotificationApplication } from "./usecases/notification-application.js";
import { createTripApiHandler } from "./trip-handler.js";
import { createTripSharingHandler } from "./trip-sharing-handler.js";
import { createNotificationHandler } from "./notification-handler.js";
import { createInTripContextHandler } from "./in-trip-context-handler.js";
import { jsonResponse, type LambdaHttpEvent, type LambdaContext } from "./contracts/http.js";

/** Opt-in host factory, not installed in lambda.ts. No production flag/env fallback.
 * auth is the trusted cognito_api_auth_config Terraform output, never HTTP input.
 * This is a standard Bearer host; CloudFront Basic/OAC forwarding remains #462/#480 work.
 */
export function createPersonalApiHandler(options: {
  enabled?: boolean;
  auth: { userPoolId: string; clientId: string; requiredScopes: readonly string[] };
  tripTable: string;
  notificationTable: string;
}) {
  if (options.enabled !== true) return async (_event: LambdaHttpEvent, _context?: LambdaContext) =>
    jsonResponse(501, { error: "unavailable" });
  if (!options.tripTable || !options.notificationTable) throw new Error("Missing personal API configuration");
  const authenticate = createHttpPrincipalResolver(createCognitoAccessTokenVerifier(options.auth), options.auth.requiredScopes);
  const applications = createAuthorizedTripApplications(options.tripTable);
  const trips = createTripApiHandler(applications.trips, { authenticate });
  const sharing = createTripSharingHandler(applications.sharing, { authenticate });
  const notifications = createNotificationHandler(new NotificationApplication(
    new DynamoDbNotificationRepository(options.notificationTable, options.tripTable),
    new DynamoDbTripRepository(options.tripTable)), authenticate);
  const inTrip = createInTripContextHandler(createInTripContextApplication(options.tripTable, options.notificationTable), authenticate);
  return (event: LambdaHttpEvent, context?: LambdaContext) => {
    if (event.rawPath && event.path && event.rawPath !== event.path) return Promise.resolve(jsonResponse(404, { error: "not-found" }));
    switch (event.rawPath ?? event.path) {
      case personalApiPolicies.trip.path: return trips(event, context);
      case personalApiPolicies.sharing.path: return sharing(event, context);
      case personalApiPolicies.notification.path: return notifications(event);
      case personalApiPolicies.inTrip.path: return inTrip(event);
      default: return Promise.resolve(jsonResponse(404, { error: "not-found" }));
    }
  };
}
