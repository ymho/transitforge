import { createCognitoAccessTokenVerifier } from "./adapters/cognito-access-token-verifier.js";
import { lambdaStreamHandler, type LambdaStreamingApi } from "./adapters/agent-stream/lambda.js";
import { createProductionAgentStream } from "./agent-stream-composition.js";
import { createServerAgent } from "./server-agent-composition.js";
import { AwsBedrockConverseClient } from "./adapters/aws-sdk-clients.js";
import { BedrockConversationModel } from "./adapters/bedrock-conversation-model.js";
import { OpenMeteoWeatherProvider } from "./adapters/open-meteo-weather-provider.js";
import { agentSystemPrompt } from "./usecases/agent-system-prompt.js";

declare const awslambda: LambdaStreamingApi;
const enabled = process.env.AGENT_STREAM_ENABLED === "true";
// No client/JWKS/model construction while disabled. No fixture or Browser runtime fallback.
const verifier = enabled ? createCognitoAccessTokenVerifier({
  userPoolId: process.env.COGNITO_USER_POOL_ID ?? "", clientId: process.env.COGNITO_CLIENT_ID ?? "",
}) : { verify: async () => { throw new Error("Streaming disabled"); } };
export const handler = lambdaStreamHandler(awslambda, createProductionAgentStream({
  enabled, path: process.env.AGENT_STREAM_PATH ?? "/api/agent-stream", verifier,
  log: fields => console.log(JSON.stringify({ eventSource: "agent_stream", ...fields })),
  createApplication: executionId => createServerAgent({
    newExecutionId: () => executionId,
    model: new BedrockConversationModel(new AwsBedrockConverseClient(), {
      modelId: process.env.MODEL_ID ?? "amazon.nova-lite-v1:0",
      lightweightModelId: process.env.LIGHTWEIGHT_MODEL_ID || undefined,
      decisionModelId: process.env.DECISION_MODEL_ID || undefined,
      systemPrompt: agentSystemPrompt,
    }),
    weather: new OpenMeteoWeatherProvider({ fetch: globalThis.fetch }),
    // Fixed-IP Providers attach through additionalTools after their VPC boundary is ready.
    // Conversation/Profile loading belongs to #479; this minimum composition is not a cutover candidate.
  }),
}));
