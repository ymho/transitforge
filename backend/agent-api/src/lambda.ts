import { createAgentApplication } from "./composition-root.js";
import { createAgentApiHandler } from "./handler.js";
import { createTripApiHandler } from "./trip-handler.js";
import type { LambdaHttpEvent, LambdaContext } from "./contracts/http.js";

const application = createAgentApplication();

const agentHandler = createAgentApiHandler(application, {
  log: (event, fields) => console.log(JSON.stringify({ event, ...fields })),
});

// Fail closed. CloudFront/IAM origin protection is NOT an authenticated end-user principal.
// Do not install a Trip application/verifier here until real auth and #389 writer gates are reviewed.
const tripHandler = createTripApiHandler();
export const handler = (event: LambdaHttpEvent, context?: LambdaContext) =>
  event.rawPath === "/api/trips" || event.rawPath?.startsWith("/api/trips/")
    ? tripHandler(event, context) : agentHandler(event, context);
