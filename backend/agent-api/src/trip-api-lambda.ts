import { createTripApiPublicHandler } from "./trip-api-composition.js";

export const handler = createTripApiPublicHandler({
  enabled: process.env.TRIP_API_ENABLED === "true",
  auth: { userPoolId: process.env.COGNITO_USER_POOL_ID ?? "", clientId: process.env.COGNITO_CLIENT_ID ?? "", requiredScopes: ["raiquora/user"] },
  tripTable: process.env.TRIP_TABLE_NAME ?? "",
  stateTable: process.env.SERVER_STATE_TABLE_NAME ?? "",
});
