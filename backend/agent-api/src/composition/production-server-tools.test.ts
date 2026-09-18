import { expect, it, vi } from "vitest";
import { BedrockConversationModel } from "../adapters/bedrock-conversation-model.js";
import { createTrip } from "@raiquora/trip/trip";
import { createFixedEgressProviderHandler } from "../adapters/fixed-egress-provider-handler.js";
import { createFixedEgressAccommodationOperation } from "./fixed-egress-accommodation.js";
import { productionServerTools } from "./production-server-tools.js";
import { createProductionConversationAgent } from "./production-conversation-agent.js";
import { stateDynamoFixture, stateA, conversationId, secondId } from "../adapters/state-dynamodb.fixture.js";
import { tripDynamoFixture } from "../adapters/trip-dynamodb.fixture.js";

it("restores a Trip without Profile, invokes fixed-egress through the existing operation, and persists the grounded final", async () => {
  const state = stateDynamoFixture(), trips = tripDynamoFixture();
  await trips.repository.create(stateA, createTrip(secondId, "server trip", "2026-09-18T00:00:00Z"));
  const search = vi.fn(async () => [{ kind: "accommodation" as const, provider: "travel-provider", providerItemId: "42", name: "宿",
    checkInDate: "2026-10-01", checkOutDate: "2026-10-02", availability: "unknown" as const }]);
  const provider = createFixedEgressProviderHandler({ search });
  const invoke = vi.fn(async (input: { Payload: Uint8Array }) => ({ StatusCode: 200,
    Payload: new TextEncoder().encode(JSON.stringify(await provider(JSON.parse(new TextDecoder().decode(input.Payload))))) }));
  const converse = vi.fn(async () => converse.mock.calls.length === 1
    ? { output: { message: { role: "assistant", content: [{ toolUse: { toolUseId: "accommodation", name: "search_accommodations",
      input: { destination: "京都", checkInDate: "2026-10-01", checkOutDate: "2026-10-02" } } }] } }, stopReason: "tool_use" }
    : { output: { message: { role: "assistant", content: [{ text: '<decision_summary>{"interpretedGoal":"宿を調べる","hardConstraints":[],"softPreferences":[],"selectedAction":"answer","unresolvedFacts":[],"reasonCodes":["evidence_sufficient"],"usedEvidenceIds":["accommodation:travel-provider:42"]}</decision_summary>候補の宿を確認しました。空室は未確認です。' }] } }, stopReason: "end_turn" });
  const app = createProductionConversationAgent({ stateTable: "test-state", tripTable: "test-trips", stateClient: state.client, tripClient: trips.client,
    model: new BedrockConversationModel({ converse }, { modelId: "test", systemPrompt: "test" }), weather: { search: vi.fn() }, newExecutionId: () => "execution",
    additionalTools: productionServerTools({ external: {}, accommodation: createFixedEgressAccommodationOperation("provider-arn", { invoke }), journey: vi.fn() }),
  });
  const request = { principal: stateA, conversationId, turnId: secondId, tripId: secondId, userRequest: "京都の宿を調べたい" };
  const final = await app.runConversationTurn(request);
  expect(final.response).toContain("宿泊候補「宿」"); expect(final.response).not.toContain("decision_summary");
  expect(invoke).toHaveBeenCalledTimes(1); expect(search).toHaveBeenCalledWith(expect.objectContaining({ destination: "京都", adults: 1 }), "execution");
  expect(JSON.stringify(converse.mock.calls)).toContain("server trip");
  expect(JSON.stringify(invoke.mock.calls)).not.toMatch(/principal|Bearer|profile/);
  expect((await state.conversations.history(stateA, conversationId)).items.map(m => m.role)).toEqual(["user", "assistant"]);
  expect(await app.runConversationTurn(request)).toEqual(final); expect(invoke).toHaveBeenCalledTimes(1); expect(converse).toHaveBeenCalledTimes(2);
});
