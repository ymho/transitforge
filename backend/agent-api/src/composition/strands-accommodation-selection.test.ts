import { expect, it, vi } from "vitest";
import { createTrip } from "@raiquora/trip/trip";
import { projectStaySchedule } from "@raiquora/trip/itinerary-schedule";
import { stateDynamoFixture, stateA, stateB, conversationId, stateMetadata } from "../adapters/state-dynamodb.fixture.js";
import { tripDynamoFixture } from "../adapters/trip-dynamodb.fixture.js";
import { HttpAccommodationProvider } from "../adapters/http-accommodation-provider.js";
import { createFixedEgressProviderHandler } from "../adapters/fixed-egress-provider-handler.js";
import { createFixedEgressAccommodationOperation } from "./fixed-egress-accommodation.js";
import { productionServerTools } from "./production-server-tools.js";
import { rakutenAccommodationSelectionEvidence } from "../adapters/rakuten-accommodation-selection.js";
import { VerifiedAccommodationSelections } from "../usecases/verified-accommodation-selection.js";
import { StrandsAgentEngine, strandsProductionReasoning } from "../adapters/strands-agent-engine.js";
import { StrandsScriptedModel } from "../adapters/strands-scripted-model.fixture.js";
import { createStrandsServerRuntime } from "../adapters/strands-server-runtime.js";
import { createConversationServerAgent } from "./conversation-server-agent.js";
import { agentV2SystemPrompt } from "../usecases/agent-v2-system-prompt.js";
import { stableSelectionMutation } from "../usecases/agent/presented-candidate-selection.js";

const live = process.env.AGENT_V2_LIVE === "true";
const modelId = process.env.MODEL_ID ?? "jp.anthropic.claude-sonnet-4-6";
const settings = { modelId, region: "ap-northeast-1", systemPrompt: agentV2SystemPrompt, maxTurns: 6,
  maxOutputTokens: 4096, maxInvocationOutputTokens: 4096, ...strandsProductionReasoning(modelId) };
const output = (reply: unknown) => ({ name: "strands_structured_output", input: { reply } });

it.each(["multiple", "named", "ordinal", "sole"] as const)(`${live ? "Bedrock" : "SDK"} hotel %s retains actual adapter identity through history, adoption and replay`, async mode => {
  const state = stateDynamoFixture(), trips = tripDynamoFixture(), metadata = stateMetadata();
  const at = "2026-10-04T00:00:00Z", checkInDate = "2026-10-05", checkOutDate = "2026-10-06";
  trips.seed(createTrip(metadata.tripId, "出雲の旅", at, [
    { id: "visit", type: "activity", title: "出雲大社", category: "other", schedule: { type: "unscheduled" } },
    { id: "stay", type: "stay", title: "宿泊", schedule: projectStaySchedule(checkInDate, checkOutDate), selection: { status: "unselected" } },
  ]), stateA.subject);
  await state.conversations.create(stateA, conversationId, metadata);
  const names = ["検証用出雲駅前ホテル", "出雲ロイヤルホテル", "検証用大社ホテル"];
  // Synthetic API-shaped data, not a recorded provider response or fabricated permission proof.
  const fetch = vi.fn(async () => ({ ok: true, async json() { return { hotels: names.slice(0, mode === "sole" ? 1 : 3).map((hotelName, index) => [{ hotelBasicInfo: {
    hotelNo: 100 + index, hotelName, hotelInformationUrl: `https://example.org/hotel/${100 + index}?affiliateId=fixture`,
    hotelMinCharge: 5100, hotelImageUrl: "https://example.org/photo.jpg", reviewAverage: 4.24, address1: "島根県", address2: "出雲市", latitude: 35.3, longitude: 132.7,
  } }]) }; } }));
  const handler = createFixedEgressProviderHandler(new HttpAccommodationProvider({ fetch }, { async load() {
    return { applicationId: "fixture-app", accessKey: "fixture-key", hotelSearchUrl: "https://example.org/search" };
  } }, () => at));
  const invoke = vi.fn(async (input: { Payload: Uint8Array }) => ({ StatusCode: 200,
    Payload: new TextEncoder().encode(JSON.stringify(await handler(JSON.parse(new TextDecoder().decode(input.Payload))))) }));
  const selections = new VerifiedAccommodationSelections();
  const initialSteps = [
    { name: "search_accommodations", input: { destination: "出雲大社", checkInDate, checkOutDate, adults: 2, limit: 3 } },
    output({ kind: "uncertainty", text: "候補を確認できませんでした。" }),
  ];
  const bindings = productionServerTools({ external: {}, journey: vi.fn(), accommodation: createFixedEgressAccommodationOperation("fixture-provider", { invoke }),
    onAccommodationEvidence: (offerings, evidence, retrievedAt) => {
      selections.record(offerings, offerings.flatMap(offering => {
        const proof = rakutenAccommodationSelectionEvidence(offering, retrievedAt); return proof ? [proof] : [];
      }), evidence);
      initialSteps[1] = output({ kind: "candidates", evidenceIds: evidence.map(item => item.id), commentary: "検索した宿泊候補です。どのホテルにしますか？" });
    } });
  const prelude = createStrandsServerRuntime(new StrandsAgentEngine(settings, { model: new StrandsScriptedModel(initialSteps) }));
  let selectionRuntime: ReturnType<typeof createStrandsServerRuntime> | undefined, execution = 0, runtimeCalls = 0;
  let selectionReply: unknown;
  const app = createConversationServerAgent({ stateTable: "test-state", tripTable: "test-trips", stateClient: state.client, tripClient: trips.client,
    weather: { search: vi.fn() }, additionalTools: bindings,
    newExecutionId: () => `78700000-2222-4000-8000-${String(++execution).padStart(12, "0")}`,
    runRuntime: async input => { runtimeCalls++; if (!selectionRuntime) return prelude(input);
      const result = await selectionRuntime(input); selectionReply = result.publicReply; return result; },
    verifiedSearchSelectionItems: result => selections.itemsFor(result.publicAccommodationPresentation),
    limits: { maxIterations: 6, maxModelCalls: 6, maxToolCalls: 3, maxExecutionMs: 60000 },
  });
  const shown = await app.runConversationTurn({ principal: stateA, conversationId, turnId: "78700000-1111-4000-8000-000000000001",
    userRequest: "10月5日から1泊、大人2名で出雲大社のホテルをいくつか検索して" });
  expect(shown.status).toBe("completed");
  expect(shown.publicAccommodationPresentation?.cards).toHaveLength(mode === "sole" ? 1 : 3);
  expect(shown.publicPlanPresentation?.candidates).toHaveLength(mode === "sole" ? 1 : 3);
  const history = await state.conversations.history(stateA, conversationId);
  expect(history.items.at(-1)?.publicAccommodationPresentation).toEqual(shown.publicAccommodationPresentation);
  const named = mode === "named", sole = mode === "sole";
  const userRequest = named ? "出雲ロイヤルホテルでお願いします" : mode === "ordinal" ? "ホテル2でお願いします" : "このホテルを保存して";
  const candidateId = shown.publicAccommodationPresentation!.cards[sole ? 0 : 1]!.evidenceId;
  selectionRuntime = createStrandsServerRuntime(new StrandsAgentEngine(settings, live ? {} : { model: new StrandsScriptedModel(mode === "multiple" ? [
    { name: "review_presented_candidates", input: { presentationId: "shown:2:accommodation" } },
    output({ kind: "clarification", target: "candidate_selection", text: "候補が複数あります。どのホテルにしますか？カードの保存ボタンからも選べます。" }),
  ] : [
    { name: "select_presented_candidate", input: { presentationId: "shown:2:accommodation", candidateId, quote: userRequest,
      reference: sole ? { kind: "sole" } : named ? { kind: "label", quote: "出雲ロイヤルホテル" } : { kind: "ordinal", ordinal: 2, quote: "2" } } },
    output({ kind: "operation_result", receiptId: stableSelectionMutation(conversationId, 3) }),
  ]) }));
  const request = { principal: stateA, conversationId, turnId: "78700000-1111-4000-8000-000000000002", userRequest };
  const result = await app.runConversationTurn(request);
  expect(result.status).toBe("completed");
  const saved = await trips.repository.get(stateA, metadata.tripId);
  expect(saved?.items.map(item => item.id)).toEqual(["visit", "stay"]);
  if (mode === "multiple") {
    expect(selectionReply).toMatchObject({ kind: "clarification", question: "candidate_selection" });
    expect(result.tripMutationReceipt).toBeUndefined(); expect(saved?.revision).toBe(0);
    expect(result.publicAccommodationPresentation).toEqual(shown.publicAccommodationPresentation);
    expect(result.publicPlanPresentation).toEqual(shown.publicPlanPresentation);
  } else {
    expect(selectionReply).toMatchObject({ kind: "operation_result", operation: { type: "save", status: "succeeded" } });
    expect(result.tripMutationReceipt).toMatchObject({ tripId: metadata.tripId, tripRevision: 1 });
    expect(saved?.items[1]).toMatchObject({ type: "stay", selection: { status: "selected", accommodation: {
      provider: "rakuten-travel", providerItemId: sole ? "100" : "101", checkInDate, checkOutDate,
      place: { name: names[sole ? 0 : 1], ref: { provider: "rakuten-travel", providerPlaceId: sole ? "100" : "101" } },
      observedPrice: { price: { currency: "JPY", amountMinor: 5100 }, basis: "reference-minimum", observedAt: at },
      sources: [{ provider: "rakuten-travel", sourceId: sole ? "100" : "101", attribution: "楽天トラベル", retrievedAt: expect.any(String) }],
    } } });
    expect(JSON.stringify(saved)).not.toMatch(/availability|bookingUrl|imageUrl|reviewAverage|fixture-key|fixture-app|affiliateId|latitude|longitude/u);
  }
  expect(await trips.repository.get(stateB, metadata.tripId)).toBeUndefined();
  const completedHistory = await state.conversations.history(stateA, conversationId);
  expect(completedHistory.items.at(-1)?.tripMutationReceipt).toEqual(result.tripMutationReceipt);
  const beforeReplay = runtimeCalls; expect(await app.runConversationTurn(request)).toEqual(result); expect(runtimeCalls).toBe(beforeReplay);
  expect((await trips.repository.get(stateA, metadata.tripId))?.revision).toBe(mode === "multiple" ? 0 : 1);
  expect(fetch).toHaveBeenCalledOnce(); expect(invoke).toHaveBeenCalledOnce();
  if (live) console.log(JSON.stringify({ mode: `hotel-${mode}`, status: result.status, tripRevision: saved?.revision, replay: true }));
}, 90000);
