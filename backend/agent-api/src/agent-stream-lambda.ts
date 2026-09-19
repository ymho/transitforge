import { createCognitoAccessTokenVerifier } from "./adapters/cognito-access-token-verifier.js";
import { lambdaStreamHandler, type LambdaStreamingApi } from "./adapters/agent-stream/lambda.js";
import { createProductionAgentStream } from "./agent-stream-composition.js";
import { createProductionServerAgent } from "./production-server-agent-composition.js";

declare const awslambda: LambdaStreamingApi;
const verifier = createCognitoAccessTokenVerifier({
  userPoolId: process.env.COGNITO_USER_POOL_ID ?? "", clientId: process.env.COGNITO_CLIENT_ID ?? "",
});
export const handler = lambdaStreamHandler(awslambda, createProductionAgentStream({
  enabled: true, path: process.env.AGENT_STREAM_PATH ?? "/api/agent-stream", verifier,
  log: fields => console.log(JSON.stringify({ eventSource: "agent_stream", ...fields })),
  createApplication: createProductionServerAgent,
}));
