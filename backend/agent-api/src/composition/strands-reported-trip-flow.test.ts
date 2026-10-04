import { expect, it, vi } from "vitest";
import { createTrip } from "@raiquora/trip/trip";
import { searchJourneyIndex } from "@raiquora/journey/journey-search-engine";
import { projectPublicJourneyPresentation } from "@raiquora/agent/public-journey-presentation";
import { stateDynamoFixture, stateA, stateB, conversationId, stateMetadata } from "../adapters/state-dynamodb.fixture.js";
import { tripDynamoFixture } from "../adapters/trip-dynamodb.fixture.js";
import { StrandsAgentEngine, strandsProductionReasoning } from "../adapters/strands-agent-engine.js";
import { StrandsScriptedModel } from "../adapters/strands-scripted-model.fixture.js";
import { createStrandsServerRuntime } from "../adapters/strands-server-runtime.js";
import { HttpAccommodationProvider } from "../adapters/http-accommodation-provider.js";
import { createFixedEgressProviderHandler } from "../adapters/fixed-egress-provider-handler.js";
import { rakutenAccommodationSelectionEvidence } from "../adapters/rakuten-accommodation-selection.js";
import { VerifiedAccommodationSelections } from "../usecases/verified-accommodation-selection.js";
import { VerifiedJourneySelections } from "../usecases/verified-journey-selection.js";
import { stableSelectionMutation } from "../usecases/agent/presented-candidate-selection.js";
import { createFixedEgressAccommodationOperation } from "./fixed-egress-accommodation.js";
import { createConversationServerAgent } from "./conversation-server-agent.js";
import { productionServerTools } from "./production-server-tools.js";
import { agentV2SystemPrompt } from "../usecases/agent-v2-system-prompt.js";

const live = process.env.AGENT_V2_LIVE === "true";
const output = (reply: unknown) => ({ name: "strands_structured_output", input: { reply } });

/** Every paid turn is real Bedrock, including research, ambiguous selection and save.
 * Providers/auth/storage remain synthetic; this does not claim a deployed-user E2E. */
it(`#758 reported Izumo flow: ${live ? "Bedrock" : "SDK"} carries hotels and rail through selection, save, history and replay`, async () => {
  const state = stateDynamoFixture(), trips = tripDynamoFixture(), metadata = stateMetadata();
  const now = "2026-10-04T00:00:00Z", day = "2026-10-05", nextDay = "2026-10-06";
  trips.seed(createTrip(metadata.tripId, "出雲旅行", now), stateA.subject);
  await state.conversations.create(stateA, conversationId, metadata);
  const hotels = new VerifiedAccommodationSelections(), rails = new VerifiedJourneySelections();
  const names = ["検証用出雲駅前ホテル", "出雲ロイヤルホテル", "検証用大社ホテル"];
  const providerFetch = vi.fn(async () => ({ ok: true, async json() { return { hotels: names.map((hotelName, i) => [{ hotelBasicInfo: {
    hotelNo: 100 + i, hotelName, hotelInformationUrl: `https://example.org/hotel/${100 + i}`,
    hotelMinCharge: 5100, reviewAverage: 4.24, address1: "島根県", address2: "出雲市",
  } }]) }; } }));
  const handler = createFixedEgressProviderHandler(new HttpAccommodationProvider({ fetch: providerFetch }, { async load() {
    return { applicationId: "fixture-app", accessKey: "fixture-key", hotelSearchUrl: "https://example.org/search" };
  } }, () => now));
  const invoke = vi.fn(async (input: { Payload: Uint8Array }) => ({ StatusCode: 200,
    Payload: new TextEncoder().encode(JSON.stringify(await handler(JSON.parse(new TextDecoder().decode(input.Payload))))) }));
  // Deliberately synthetic timetable, not a claim of a real direct service.
  const index = { schema_version: "direct-service-index-v1", service_date: day, services: Object.fromEntries([0, 1].map(i => [String(i), {
    service_uid: `fixture-rail-${i}`, train_no: `${i + 1}M`, service_type: "普通", train_name: "",
    origin_station: "向日町", destination_station: "出雲市", calls: [
      { station_name: "向日町", departure_time_minutes: 480 + i * 60 },
      { station_name: "出雲市", arrival_time_minutes: 780 + i * 60 },
    ],
  }])) };
  const rail = searchJourneyIndex({ serviceDate: day, originStation: "向日町", destinationStation: "出雲市", departureTimeMinutes: 480, limit: 3 }, { index });
  const journey = vi.fn(async () => { rails.record(rail, index, now); return { body: JSON.parse(JSON.stringify(rail)) }; });
  const sourceUrl = "https://example.org/izumo";
  let hotelIds: string[] = [];
  let scripted: { name: string; input: unknown }[] = [];
  const bindings = productionServerTools({
    discovery: vi.fn(async () => ({ body: { discovery: { batch: { hits: [{ hitId: "izumo", sourceRef: sourceUrl, retrievalChannel: "web", text: "出雲大社", originalRank: 1 }], coverage: { completedQueries: 1 }, incompleteReasons: [] } } } })),
    external: {
      readWebPages: vi.fn(async () => ({ webPages: { status: "available", freshness: "fresh", data: { pages: [{ url: sourceUrl, title: "出雲大社", text: "出雲大社と周辺の参拝先を紹介します。" }] }, evidence: [{ id: "page", provider: "fixture", sourceUrl, retrievedAt: now }] } })),
      searchPlaceMedia: vi.fn(async () => ({ result: { status: "available", freshness: "fresh", data: { places: [{ providerPlaceId: "izumo", name: "出雲大社", summary: "歴史ある神社", sourceUrl, openingHoursStatus: "unknown" }] }, evidence: [{ id: "place", provider: "fixture", sourceUrl, retrievedAt: now }] } })),
    }, accommodation: createFixedEgressAccommodationOperation("fixture-provider", { invoke }), journey,
    onAccommodationEvidence: (offerings, evidence, retrievedAt) => {
      hotels.record(offerings, offerings.flatMap(offering => {
        const proof = rakutenAccommodationSelectionEvidence(offering, retrievedAt); return proof ? [proof] : [];
      }), evidence);
      hotelIds = evidence.map(item => item.id);
      if (!live) scripted[1] = output({ kind: "candidates", evidenceIds: hotelIds, commentary: "3件の宿泊候補です。参考最安料金で、空室は未確認です。" });
    },
  });
  const modelId = process.env.MODEL_ID ?? "jp.anthropic.claude-sonnet-4-6";
  let executions = 0, runtimeCalls = 0;
  const app = createConversationServerAgent({ stateTable: "test-state", tripTable: "test-trips", stateClient: state.client, tripClient: trips.client,
    weather: { search: vi.fn() }, additionalTools: bindings,
    newExecutionId: () => `75800000-2222-4000-8000-${String(++executions).padStart(12, "0")}`,
    runRuntime: input => { runtimeCalls++;
      const controller = input.candidateController;
      const observed = live && controller ? { ...controller, review: async (id?: string) => {
        const result = await controller.review(id);
        console.log(JSON.stringify({ scenario: "reported-izumo", turn: executions, review: result.status, groupKind: result.group?.kind ?? null,
          requestedKind: controller.context.groups.find(group => group.presentationId === id)?.kind ?? null, omittedGroup: !id, groupCount: controller.context.groups.length }));
        return result;
      } } : controller;
      return createStrandsServerRuntime(new StrandsAgentEngine({ modelId, region: "ap-northeast-1",
      systemPrompt: agentV2SystemPrompt, ...strandsProductionReasoning(modelId), maxTurns: 8, maxOutputTokens: 4096, maxInvocationOutputTokens: 4096,
    }, live ? {} : { model: new StrandsScriptedModel(scripted) }))({ ...input, candidateController: observed }); },
    projectResult: result => ({ publicJourneyPresentation: projectPublicJourneyPresentation(rail, new Set(result.claims.flatMap(claim => claim.evidenceIds))) }),
    verifiedSearchSelectionItems: result => [...hotels.itemsFor(result.publicAccommodationPresentation), ...rails.itemsFor(result.publicJourneyPresentation)],
    limits: { maxIterations: 8, maxModelCalls: 8, maxToolCalls: 4, maxExecutionMs: 90000 },
    diagnostics: { record: async event => { if (live && event.phase === "execution") console.log(JSON.stringify({ scenario: "reported-izumo", turn: executions, counts: event.counts, reason: event.reason })); } },
  });
  type Result = Awaited<ReturnType<typeof app.runConversationTurn>>;
  const results: Result[] = [];
  const ack = (text: string) => output({ kind: "conversation", message: "acknowledgement", text });
  const select = (presentationId: string, candidateId: string, quote: string, reference: unknown) => [
    { name: "select_presented_candidate", input: { presentationId, candidateId, quote, reference } },
    output({ kind: "operation_result", receiptId: stableSelectionMutation(conversationId, results.length * 2 + 1) }),
  ];
  async function turn(userRequest: string, steps: typeof scripted) {
    scripted = steps;
    const request = { principal: stateA, conversationId, turnId: `75800000-1111-4000-8000-${String(results.length + 1).padStart(12, "0")}`, userRequest, uiContext: { calendarDate: "2026-10-04" } };
    const started = Date.now(), result = await app.runConversationTurn(request);
    expect(result.status, `turn ${results.length + 1} must complete`).toBe("completed");
    const before = runtimeCalls;
    expect(await app.runConversationTurn(request)).toEqual(result);
    expect(runtimeCalls).toBe(before);
    results.push(result);
    if (live) console.log(JSON.stringify({ scenario: "reported-izumo", turn: results.length, status: result.status, durationMs: Date.now() - started, replay: true,
      hotelCards: result.publicAccommodationPresentation?.cards.length ?? 0, journeys: result.publicJourneyPresentation?.journeys.length ?? 0, saved: !!result.tripMutationReceipt }));
    return result;
  }
  await turn("出雲大社にいきたい", [{ name: "update_current_destination", input: { action: "set", place: "出雲大社", quote: "出雲大社にいきたい" } }, ack("出雲大社への希望を反映しました。")]);
  await turn("明日から1泊で行きたい", [{ name: "update_current_travel_period", input: { action: "set", period: { start: { kind: "relative_date", relation: "tomorrow" }, duration: { unit: "nights", amount: 1 } }, quote: "明日から1泊で行きたい" } }, ack("明日から1泊の希望を反映しました。")]);
  const draft = await turn("はい、旅程案を作成してください。交通と宿は後から選びたいです。", [{ name: "draft_itinerary", input: { variants: [{ label: "出雲の1泊旅行", dayCount: 2, items: [
    { kind: "transport", title: "往路（未選択）", day: 1 }, { kind: "activity", title: "出雲大社を参拝", day: 1 },
    { kind: "stay", title: "宿泊先（未選択）", day: 1, endDay: 2 }, { kind: "transport", title: "帰路（未選択）", day: 2 },
  ] }], unknowns: ["出発駅・時刻と宿泊先は未選択"] } }, ack("2日分の仮旅程案です。")]);
  expect(draft.publicPlanPresentation?.candidates).toHaveLength(1);
  expect((await trips.repository.get(stateA, metadata.tripId))?.items).toEqual([]);
  const planId = draft.publicPlanPresentation!.candidates[0]!.variantId;
  await turn("旅程案1を保存してください", select("shown:6:plan", planId, "旅程案1を保存してください", { kind: "ordinal", ordinal: 1, quote: "1" }));
  const shown = await turn("出雲大社近辺のホテルを3件、明日から1泊、大人1名で検索してください。", [
    { name: "search_accommodations", input: { destination: "出雲大社", checkInDate: day, checkOutDate: nextDay, adults: 1, limit: 3 } }, output({ kind: "uncertainty" }),
  ]);
  expect(shown.publicAccommodationPresentation?.cards).toHaveLength(3);
  const beforeChoice = await trips.repository.get(stateA, metadata.tripId);
  const ambiguous = await turn("このホテルを保存して", [{ name: "review_presented_candidates", input: { presentationId: "shown:10:accommodation" } },
    output({ kind: "clarification", target: "candidate_selection", text: "3件あります。どのホテルにしますか？" })]);
  expect(ambiguous.tripMutationReceipt).toBeUndefined();
  expect(await trips.repository.get(stateA, metadata.tripId)).toEqual(beforeChoice);
  expect(ambiguous.publicAccommodationPresentation).toEqual(shown.publicAccommodationPresentation);
  const royal = shown.publicAccommodationPresentation!.cards.find(card => card.name === names[1])!;
  await turn("出雲ロイヤルホテルでお願いします", select("shown:12:accommodation", royal.evidenceId, "出雲ロイヤルホテルでお願いします", { kind: "label", quote: "出雲ロイヤルホテル" }));
  const hotelSaved = await trips.repository.get(stateA, metadata.tripId);
  expect(hotelSaved?.items).toContainEqual(expect.objectContaining({ type: "stay", selection: expect.objectContaining({ status: "selected", accommodation: expect.objectContaining({ provider: "rakuten-travel", providerItemId: "101" }) }) }));
  await turn("電車も検索してください。出発駅は向日町駅です。", [{ name: "update_current_origin", input: { action: "set", place: "向日町駅", quote: "向日町駅" } }, output({ kind: "clarification", target: "departure_time", text: "何時ごろに出発しますか？" })]);
  const routes = await turn("明日の朝8時以降、向日町駅から出雲市駅までの電車を検索してください。", [{ name: "search_journeys", input: { serviceDate: day, originStation: "向日町駅", destinationStation: "出雲市駅", departureTimeMinutes: 480 } },
    output({ kind: "answer", references: [{ evidenceId: `journey:${day}:0`, field: "departureTimeMinutes" }, { evidenceId: `journey:${day}:1`, field: "departureTimeMinutes" }], commentary: "2件の経路候補です。" })]);
  expect(routes.publicJourneyPresentation?.journeys).toHaveLength(2);
  const journeyCalls = journey.mock.calls.length;
  await turn("経路1でお願いします", select("shown:18:journey", "journey-1", "経路1でお願いします", { kind: "ordinal", ordinal: 1, quote: "1" }));
  expect(journey.mock.calls.length).toBe(journeyCalls);
  const saved = await trips.repository.get(stateA, metadata.tripId);
  const returnItems = hotelSaved!.items.filter(item => item.type === "transport" && item.schedule.type === "relative" && item.schedule.dayId === hotelSaved!.timeline!.logicalDays[1]!.id);
  expect(returnItems).toHaveLength(1);
  expect(saved?.items.filter(item => returnItems.some(original => original.id === item.id))).toEqual(returnItems);
  expect(saved?.items).toContainEqual(expect.objectContaining({ type: "transport", detail: expect.objectContaining({ status: "selected", mode: "rail", journey: expect.objectContaining({ legs: [expect.objectContaining({ serviceUid: "fixture-rail-0" })] }) }) }));
  expect(saved?.items.filter(item => item.type === "stay")).toEqual(hotelSaved?.items.filter(item => item.type === "stay"));
  expect(saved?.items.filter(item => item.type === "activity")).toEqual(hotelSaved?.items.filter(item => item.type === "activity"));
  expect(await trips.repository.get(stateB, metadata.tripId)).toBeUndefined();
  const history = await state.conversations.history(stateA, conversationId);
  expect(history.items).toHaveLength(20);
  for (let i = 0; i < results.length; i++) {
    expect(history.items[i * 2 + 1]?.publicAccommodationPresentation).toEqual(results[i]?.publicAccommodationPresentation);
    expect(history.items[i * 2 + 1]?.publicJourneyPresentation).toEqual(results[i]?.publicJourneyPresentation);
    expect(history.items[i * 2 + 1]?.tripMutationReceipt).toEqual(results[i]?.tripMutationReceipt);
  }
}, 1_000_000);
