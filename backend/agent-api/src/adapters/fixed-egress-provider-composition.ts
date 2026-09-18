import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { createFixedEgressProviderHandler } from "./fixed-egress-provider-handler.js";
import { fixedEgressHttpClient } from "./fixed-egress-http-client.js";
import { HttpAccommodationProvider } from "./http-accommodation-provider.js";
import { SecretsManagerTravelProviderCredentials } from "./secrets-manager-travel-provider-credentials.js";

const client = new SecretsManagerClient({ maxAttempts: 1 });
const credentials = new SecretsManagerTravelProviderCredentials({
  getSecretValue: input => client.send(new GetSecretValueCommand(input), { abortSignal: AbortSignal.timeout(3_000) }),
}, process.env.FIXED_EGRESS_TRAVEL_SECRET_ARN ?? "");
export const fixedEgressProviderHandler = createFixedEgressProviderHandler(new HttpAccommodationProvider(fixedEgressHttpClient(), credentials));
