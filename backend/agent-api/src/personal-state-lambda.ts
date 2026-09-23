import { createPersonalStateApiHandler } from "./personal-state-api-composition.js";

export const handler = createPersonalStateApiHandler({
  enabled: process.env.PERSONAL_STATE_API_ENABLED === "true",
  auth: { userPoolId: process.env.COGNITO_USER_POOL_ID ?? "", clientId: process.env.COGNITO_CLIENT_ID ?? "", requiredScopes: ["raiquora/user"] },
  stateTable: process.env.SERVER_STATE_TABLE_NAME ?? "",
  tripTable: process.env.TRIP_TABLE_NAME ?? "",
});
