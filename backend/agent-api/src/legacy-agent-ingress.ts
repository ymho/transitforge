import { RequestError, type JsonObject } from "./contracts/agent-request.js";
import type { LambdaHttpEvent } from "./contracts/http.js";
import type { AccessTokenVerifier } from "./ports/access-token-verifier.js";
import { accessTokenFromHttp } from "./adapters/http-api-auth.js";
import { authenticatedApplication } from "./usecases/authenticated-application.js";

const protectedOperations = new Set([
  "weather_grid_search", "weather_forecast_search",
  "representative_timetable_search", "journey_search", "daily_congestion_analysis",
  "daily_congestion_peak", "train_delay_analysis", "travel_accommodation_search",
  "place_media_search", "place_detail_research", "web_search", "web_page_read",
  "travel_alert_search", "ground_access_search", "restaurant_search",
]);

/** OAC owns Authorization. The dedicated header transports an UNTRUSTED token,
 * never an identity; the same Cognito verifier and scope as Server Agent validate it.
 * No flag or missing/unknown operation can reopen the old model conversation.
 */
export function authorizeLegacyAgentRequest(verifier: AccessTokenVerifier) {
  const authenticate = authenticatedApplication(verifier, ["raiquora/user"], async () => undefined);
  return async (event: LambdaHttpEvent, value: JsonObject): Promise<void> => {
    if (typeof value.operation !== "string" || !protectedOperations.has(value.operation)) {
      throw new RequestError(410, "旧Agent会話経路は終了しました。");
    }
    if (["messages", "toolDefinitions", "modelClass", "modelCallId"].some(key => key in value)) {
      throw new RequestError(400, "Agent会話は/api/agent-streamを使用してください。");
    }
    // Reuse strict duplicate/coalesced header handling; SigV4 Authorization is not a user token.
    await authenticate(accessTokenFromHttp(event, "x-raiquora-access-token"), undefined);
  };
}
