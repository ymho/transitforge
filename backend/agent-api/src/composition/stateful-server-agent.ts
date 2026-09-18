import { DynamoDbConversationRepository } from "../adapters/dynamodb-conversation-repository.js";
import { DynamoDbProfileRepository } from "../adapters/dynamodb-profile-repository.js";
import { DynamoDbTripRepository, type TripDynamoClient } from "../adapters/dynamodb-trip-repository.js";
import type { StateDynamoClient } from "../adapters/dynamodb-state-store.js";
import { ConversationApplication } from "../usecases/conversation-application.js";
import { ProfileApplication } from "../usecases/profile-application.js";
import { createServerStateContextLoader } from "../usecases/agent/server-state-context-loader.js";
import { createServerAgent } from "../server-agent-composition.js";

/** Internal stateful composition. Transport/auth rollout and env bindings remain with #451/#462/#480. */
export function createStatefulServerAgent(options: Omit<Parameters<typeof createServerAgent>[0], "loadContext"> & {
  stateTable: string;
  tripTable: string;
  stateClient?: StateDynamoClient;
  tripClient?: TripDynamoClient;
}) {
  return createServerAgent({ ...options,
    // Restored private state may be echoed in any later turn block. Do not retain raw model-call traces.
    // Runtime metadata/latency diagnostics remain available; no Bedrock/provider implementation change.
    model: { converse: ({ trace: _trace, ...request }) => options.model.converse(request) },
    loadContext: createServerStateContextLoader({
      conversations: new ConversationApplication(new DynamoDbConversationRepository(options.stateTable, options.stateClient)),
      profiles: new ProfileApplication(new DynamoDbProfileRepository(options.stateTable, options.stateClient)),
      trips: new DynamoDbTripRepository(options.tripTable, options.tripClient),
    }),
  });
}
