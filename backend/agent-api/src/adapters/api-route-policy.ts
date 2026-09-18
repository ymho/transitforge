import { TripResourceError } from "../contracts/trip-api.js";
import type { LambdaHttpEvent } from "../contracts/http.js";

/** Executable allowlist for the four personal HTTP handlers. Scopes come from Terraform. */
export const personalApiPolicies = {
  trip: { path: "/api/trips/v1", version: "trip-api-v1", operations: ["create", "mutate", "get", "list", "archive", "attach", "detach", "reference"] },
  sharing: { path: "/api/trips/sharing/v1", version: "trip-sharing-v1", operations: ["create-grant", "redeem", "revoke-grant", "manage", "participant", "accessible", "reservation-facts"] },
  notification: { path: "/api/trips/notifications/v1", version: "notification-api-v1", operations: ["list", "read"] },
  inTrip: { path: "/api/trips/in-trip/v1", version: "in-trip-api-v1", operations: [undefined] },
} as const;
export type PersonalApi = keyof typeof personalApiPolicies;

/** Classification is not activation. Deferred handlers are NOT protected by this inventory alone. */
export const apiAuthenticationInventory = {
  public: ["/", "/index.html", "/auth-config.json", "/assets/*", "/viewer-input/*", "/api/traffic/*"],
  authenticated: Object.values(personalApiPolicies).map(policy => policy.path),
  deferredAuthenticated: { "/api/agent": "#462/#480, including conversation_feedback and agent_trace" },
  internalIamOnly: ["trip-changed-lambda", "rail-impact-lambda", "trip-recheck-lambda", "notification-lambda"],
  applicationOnly: ["ReservationApplication", "ChecklistApplication"],
} as const;

export function requirePersonalOperation(route: PersonalApi, event: LambdaHttpEvent, value: unknown): void {
  const policy = personalApiPolicies[route];
  // Host router selects an exact path. Optional path supports handler-only/internal test hosts.
  if (event.rawPath !== undefined && event.rawPath !== policy.path || event.path !== undefined && event.path !== policy.path ||
      event.rawQueryString || Object.keys(event.queryStringParameters ?? {}).length ||
      Object.keys(event.multiValueQueryStringParameters ?? {}).length ||
      !value || typeof value !== "object" || Array.isArray(value)) throw new TripResourceError("invalid-input");
  const command = value as Record<string, unknown>;
  if (command.version !== policy.version || !(policy.operations as readonly unknown[]).includes(command.operation)) {
    throw new TripResourceError("invalid-input");
  }
}
