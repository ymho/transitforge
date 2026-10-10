import { expect, it, vi } from "vitest";
import { createTrip } from "@raiquora/trip/trip";
import { searchJourneyIndex } from "@raiquora/journey/journey-search-engine";
import { stateDynamoFixture, stateA, conversationId, stateMetadata } from "../adapters/state-dynamodb.fixture.js";
import { tripDynamoFixture } from "../adapters/trip-dynamodb.fixture.js";
import { StrandsScriptedModel } from "../adapters/strands-scripted-model.fixture.js";
import { StrandsAgentEngine } from "../adapters/strands-agent-engine.js";
import { createStrandsServerRuntime } from "../adapters/strands-server-runtime.js";
import { createConversationServerAgent } from "./conversation-server-agent.js";
import { productionServerTools } from "./production-server-tools.js";
import { agentV2SystemPrompt } from "../usecases/agent-v2-system-prompt.js";

const output = (reply: unknown) => ({ name: "strands_structured_output", input: { reply } });
const ack = output({ kind: "conversation", message: "acknowledgement" });
const search = { name: "search_accommodations", input: {
  destination: "出雲大社", checkInDate: "2026-10-11", checkOutDate: "2026-10-12", adults: 2, limit: 3,
} };
const guidance = output({ kind: "clarification", target: "destination",
  text: "宿泊検索には目的地の登録が必要です。旅行条件の目的地を登録するか、『目的地を出雲大社に設定して』と伝えてください。" });

/** Actual SDK, production Tool policies, condition commits and persisted history.
 * The model, Provider and DynamoDB are synthetic; this is not a paid quality eval. */
it("recovers hotel search after a rail-only read and party registration without treating missing destination as an outage", async () => {
  const state = stateDynamoFixture(), trips = tripDynamoFixture(), metadata = stateMetadata();
  trips.seed(createTrip(metadata.tripId, "出雲旅行", "2026-10-10T00:00:00Z"), stateA.subject);
  await state.conversations.create(stateA, conversationId, metadata);
  const route = searchJourneyIndex({ serviceDate: "2026-10-11", originStation: "向日町", destinationStation: "出雲市", departureTimeMinutes: 480 }, {
    index: { schema_version: "direct-service-index-v1", service_date: "2026-10-11", services: {} },
  });
  const journey = vi.fn(async () => ({ body: JSON.parse(JSON.stringify(route)) }));
  const accommodation = vi.fn(async (_input: Record<string, unknown>) => ({ body: { accommodations: [{
    kind: "accommodation", provider: "fixture", providerItemId: "hotel-1", name: "検証用大社ホテル",
    checkInDate: "2026-10-11", checkOutDate: "2026-10-12", availability: "unknown", bookingUrl: "https://example.test/hotel",
  }] } }));
  let steps: { name: string; input: unknown }[] = [], model: StrandsScriptedModel;
  const tools = productionServerTools({ external: {}, accommodation, journey,
    onAccommodationEvidence: (_offerings, evidence) => {
      steps[steps.length - 1] = output({ kind: "candidates", evidenceIds: evidence.map(item => item.id), commentary: "宿泊候補を確認できます。空室は未確認です。" });
    } });
  let execution = 0;
  const app = createConversationServerAgent({ stateTable: "test-state", tripTable: "test-trips",
    stateClient: state.client, tripClient: trips.client, weather: { search: vi.fn() }, additionalTools: tools,
    newExecutionId: () => `81300000-2222-4000-8000-${String(++execution).padStart(12, "0")}`,
    runRuntime: input => {
      model = new StrandsScriptedModel(steps);
      return createStrandsServerRuntime(new StrandsAgentEngine({ modelId: "synthetic", region: "test",
        systemPrompt: agentV2SystemPrompt, maxTurns: 6 }, { model }))(input);
    },
  });
  let turnId = 0;
  async function turn(userRequest: string, calls: typeof steps) {
    steps = calls;
    const request = { principal: stateA, conversationId,
      turnId: `81300000-1111-4000-8000-${String(++turnId).padStart(12, "0")}`, userRequest,
      uiContext: { calendarDate: "2026-10-10" } };
    const result = await app.runConversationTurn(request);
    expect(result.status).toBe("completed");
    const before = execution;
    expect(await app.runConversationTurn(request)).toEqual(result);
    expect(execution).toBe(before);
    return result;
  }
  await turn("明日8時以降、向日町駅から出雲市駅までの電車を検索して", [
    { name: "search_journeys", input: { serviceDate: "2026-10-11", originStation: "向日町", destinationStation: "出雲市", departureTimeMinutes: 480 } },
    output({ kind: "uncertainty", text: "この検索では候補を確認できませんでした。" }),
  ]);
  expect(journey).toHaveBeenCalledOnce();
  const party = await turn("大人2人です", [{ name: "update_current_party", input: { action: "set", party: { kind: "composition", adults: 2, children: 0 }, quote: "大人2人" } }, ack]);
  expect(party.semanticReceipt?.outcome).toBe("accepted");
  const missing = await turn("周辺の宿を探して", [search, guidance]);
  expect(accommodation).not.toHaveBeenCalled();
  expect(missing.response).toContain("目的地の登録が必要");
  expect(missing.response).not.toMatch(/一時的|障害|しばらく/);
  const replies = JSON.stringify(model!.observedMessages[1]);
  expect(replies).toContain('"code":"precondition_missing"');
  expect(replies).toContain('"recovery":{"kind":"resolve_conditions","target":"destination","inputField":"destination","reason":"not_accepted"}');

  // Registering dates alone must neither bypass destination validation nor
  // manufacture a location from the earlier station-to-station read.
  const stillMissing = await turn("明日から1泊で宿を探して", [
    { name: "update_current_travel_period", input: { action: "set", period: { start: { kind: "relative_date", relation: "tomorrow" }, duration: { unit: "nights", amount: 1 } }, quote: "明日から1泊" } },
    search, guidance,
  ]);
  expect(accommodation).not.toHaveBeenCalled();
  expect(stillMissing.response).toContain("目的地の登録が必要");
  const before = await trips.repository.get(stateA, metadata.tripId);
  const recovered = await turn("出雲大社周辺の宿を大人2人・子ども0人、2026年10月11日から12日の1泊で探して", [
    { name: "update_current_party", input: { action: "set", party: { kind: "composition", adults: 2, children: 0 }, quote: "大人2人・子ども0人" } },
    { name: "update_current_travel_period", input: { action: "set", period: { start: { kind: "calendar_date", year: 2026, month: 10, day: 11 }, end: { kind: "calendar_date", day: 12 }, duration: { unit: "nights", amount: 1 } }, quote: "2026年10月11日から12日の1泊" } },
    { name: "update_current_destination", input: { action: "set", place: "出雲大社", quote: "出雲大社" } },
    search, output({ kind: "uncertainty" }),
  ]);
  expect(accommodation).toHaveBeenCalledOnce();
  expect(accommodation.mock.calls[0]?.[0]).toMatchObject(search.input);
  expect(recovered.publicAccommodationPresentation?.cards[0]?.name).toBe("検証用大社ホテル");
  const saved = await trips.repository.get(stateA, metadata.tripId);
  expect(saved?.request.party).toEqual(before?.request.party);
  expect(saved?.request.constraints.some(({ requirement }) => requirement.type === "destinations" && requirement.places.some(place => place.name === "出雲大社"))).toBe(true);
  expect(saved?.items).toEqual(before?.items);
  expect(saved?.request.constraints.find(c => c.requirement.type === "dates")?.requirement).toMatchObject({ start: { earliest: "2026-10-11" }, end: { latest: "2026-10-12" } });
  const history = await state.conversations.history(stateA, conversationId);
  expect(history.items.at(-1)?.publicAccommodationPresentation).toEqual(recovered.publicAccommodationPresentation);
});
