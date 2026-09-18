import { randomUUID } from "node:crypto";
import { createCognitoAccessTokenVerifier } from "./adapters/cognito-access-token-verifier.js";
import { createAgentStreamHandler } from "./agent-stream-poc/handler.js";
import { lambdaStreamHandler, type LambdaStreamingApi } from "./adapters/agent-stream/lambda.js";
import { syntheticAgentRun, streamScenarios, type StreamScenario } from "./agent-stream-poc/synthetic.js";
import { fakeServerAgentRun } from "./agent-stream-poc/fake-server-agent.js";

declare const awslambda: LambdaStreamingApi;
// Not included in production packaging. Requires explicit isolated PoC configuration.
if (process.env.AGENT_STREAM_POC_ENABLED !== "true") throw new Error("Streaming PoC is disabled");
const scenario = process.env.AGENT_STREAM_POC_SCENARIO ?? "immediate";
if (scenario !== "server_agent" && !Object.hasOwn(streamScenarios, scenario)) throw new Error("Invalid PoC scenario");
const verifier = createCognitoAccessTokenVerifier({ userPoolId: process.env.COGNITO_USER_POOL_ID ?? "", clientId: process.env.COGNITO_CLIENT_ID ?? "" });
export const handler = lambdaStreamHandler(awslambda, createAgentStreamHandler({ verifier, newRunId: randomUUID,
  heartbeatMs: (scenario === "silent" || scenario === "initial_silent") ? 240_000 : 10_000,
  run: scenario === "server_agent" ? fakeServerAgentRun() : syntheticAgentRun(scenario as StreamScenario),
}));
