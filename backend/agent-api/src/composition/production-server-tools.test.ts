import { expect, it, vi } from "vitest";
import { strandsScriptedRuntime } from "../adapters/strands-scripted-model.fixture.js";
import { createTrip } from "@raiquora/trip/trip";
import { createFixedEgressProviderHandler } from "../adapters/fixed-egress-provider-handler.js";
import { createFixedEgressAccommodationOperation } from "./fixed-egress-accommodation.js";
import { productionServerTools } from "./production-server-tools.js";
import { createProductionConversationAgent } from "./production-conversation-agent.js";
import { stateDynamoFixture, stateA, conversationId, secondId, stateMetadata } from "../adapters/state-dynamodb.fixture.js";
import { tripDynamoFixture } from "../adapters/trip-dynamodb.fixture.js";
const evidenceContext = { retrievedAt: "2026-09-25T00:00:00Z", queryFingerprint: "history",
  executionId: "consultation", toolCallId: "tool-1", toolName: "search_travel_knowledge" };

it("exposes purpose destination reads and composes destination sources with an attributed photo", async () => {
  const url = "https://example.org/izumo";
  const discovery = vi.fn(async () => ({ body: { discovery: { batch: { hits: [{ hitId: "hit", sourceRef: url,
    retrievalChannel: "web", text: "出雲大社", originalRank: 1 }], coverage: { completedQueries: 1 }, incompleteReasons: [] } } } }));
  const readWebPages = vi.fn(async () => ({ webPages: { status: "available", freshness: "fresh", data: {
    pages: [{ url, title: "出雲大社", text: "出雲大社は長い歴史を持つ神社です。" }] },
    evidence: [{ id: "page", provider: "reader", sourceUrl: url, retrievedAt: "2026-09-25T00:00:00Z" }] } }));
  const searchPlaceMedia = vi.fn(async () => ({ result: { status: "available", freshness: "fresh", data: { places: [{
    providerPlaceId: "izumo", name: "出雲大社", summary: "長い歴史を持つ神社です。", sourceUrl: "https://www.mapbox.com/",
    officialWebsiteUrl: url, openingHoursStatus: "unknown", image: { url: "https://images.example/izumo.jpg",
      descriptionUrl: "https://photos.example/izumo", attribution: "Example", hotlinkAllowed: true },
    sources: [{ provider: "mapbox", label: "Mapbox", url: "https://www.mapbox.com/", role: "identity" }] }] },
    evidence: [{ id: "place", provider: "mapbox", sourceUrl: "https://www.mapbox.com/", retrievedAt: "2026-09-25T00:00:00Z",
      validUntil: "2099-09-26T00:00:00Z" }] } }));
  const tools = productionServerTools({ external: { readWebPages, searchPlaceMedia }, discovery, accommodation: vi.fn(), journey: vi.fn() });
  expect(tools.map(({ descriptor }) => descriptor.name)).toEqual(expect.arrayContaining(["explore_destination", "discover_destinations"]));
  const explore = tools.find(({ descriptor }) => descriptor.name === "explore_destination")!;
  const response = await explore.operation({ destination: "出雲大社", includeNearby: true }, { requestId: "consultation" });
  expect(response.body.outcome).toMatchObject({ status: "complete", candidateCount: 1, verifiedCandidateCount: 1, photoCandidateCount: 1 });
  expect(discovery).toHaveBeenCalledWith(expect.objectContaining({ facets: expect.arrayContaining([
    { kind: "place", value: "出雲大社" }, { kind: "soft_preference", value: "周辺の立ち寄り候補" },
  ]) }), expect.objectContaining({ requestId: "consultation" }));
  expect(explore.evidence(response.body, { ...evidenceContext, toolName: "explore_destination" })
    .some((item) => item.facts.imageUrl === "https://images.example/izumo.jpg")).toBe(true);
});

it.each([
  ["no_candidates", { hits: [], coverage: { completedQueries: 1 }, incompleteReasons: [] }, undefined],
  ["failed", { hits: [], coverage: { completedQueries: 0 }, incompleteReasons: ["retrieval_failed:web"] }, undefined],
  ["partial", { hits: [{ hitId: "lead", sourceRef: "https://example.org/lead", retrievalChannel: "web" }], coverage: { completedQueries: 1 }, incompleteReasons: [] }, new Error("reader unavailable")],
] as const)("returns %s instead of conflating provider failure and empty candidates", async (status, batch, readerError) => {
  const binding = productionServerTools({ external: { readWebPages: vi.fn(async () => {
    if (readerError) throw readerError;
    return { webPages: { status: "available", freshness: "fresh", data: { pages: [] }, evidence: [] } };
  }) }, discovery: vi.fn(async () => ({ body: { discovery: { batch } } })), accommodation: vi.fn(), journey: vi.fn() })
    .find(({ descriptor }) => descriptor.name === "discover_destinations")!;
  const response = await binding.operation({ experiences: ["歴史"] }, { requestId: "consultation" });
  expect(response.body.outcome).toMatchObject({ status });
});

it("materializes discovery leads into verified page evidence in the same tool round", async () => {
  const url = "https://example.org/kurashiki";
  const readWebPages = vi.fn(async () => ({ webPages: { status: "available", freshness: "fresh",
    data: { pages: [{ url, title: "倉敷観光案内", text: "白壁の町並みを散策できます。" }] },
    evidence: [{ id: "page-1", provider: "safe-reader", sourceUrl: url }] } }));
  const discovery = vi.fn(async () => ({ body: { discovery: { batch: { hits: [{ hitId: "hit-1", sourceRef: url,
    retrievalChannel: "web", text: "検索で見つかった候補", originalRank: 1 }] } } } }));
  const tools = productionServerTools({ external: { readWebPages }, discovery, accommodation: vi.fn(), journey: vi.fn() });
  const search = tools.find((tool) => tool.descriptor.name === "search_travel_knowledge")!;
  const response = await search.operation({}, { requestId: "consultation" });
  const evidence = search.evidence(response.body, evidenceContext);
  expect(readWebPages).toHaveBeenCalledWith({ urls: [url] });
  expect(evidence.filter(item => item.facts.sourcePrecision === "read-page")).toHaveLength(1);
  expect(evidence.find((item) => item.knowledgeKind === "unverified_information")).toBeDefined();
  expect(evidence.find(item => item.facts.sourcePrecision === "read-page")?.facts.sourceExcerpt).toContain("白壁の町並み");
});

it("finds an attributed photo tied to the fetched destination page", async () => {
  const url = "https://example.org/izumo";
  const readWebPages = vi.fn(async () => ({ webPages: { status: "available", freshness: "fresh",
    data: { pages: [{ url, title: "出雲大社|出雲観光ガイド", text: "出雲大社は古社として知られています。" }] },
    evidence: [{ id: "page", provider: "safe-reader", sourceUrl: url }] } }));
  const searchPlaceMedia = vi.fn(async () => ({ result: { status: "available", freshness: "fresh", data: {
    places: [{ providerPlaceId: "izumo", name: "出雲大社", sourceUrl: "https://map.example/izumo", officialWebsiteUrl: url,
      image: { url: "https://images.example/izumo.jpg", descriptionUrl: "https://photos.example/izumo", attribution: "Example", hotlinkAllowed: true } }] },
    evidence: [{ id: "media", provider: "map", sourceUrl: "https://map.example/izumo" }] } }));
  const discovery = vi.fn(async () => ({ body: { discovery: { batch: { hits: [{ hitId: "hit", sourceRef: url,
    retrievalChannel: "web", text: "出雲大社を紹介" }] } } } }));
  const binding = productionServerTools({ external: { readWebPages, searchPlaceMedia }, discovery, accommodation: vi.fn(), journey: vi.fn() })
    .find((tool) => tool.descriptor.name === "search_travel_knowledge")!;
  const response = await binding.operation({}, { requestId: "consultation" });
  const evidence = binding.evidence(response.body, evidenceContext);
  expect(searchPlaceMedia).toHaveBeenCalledWith({ query: "出雲大社", limit: 3 });
  expect(evidence.find((item) => item.facts.imageUrl)?.facts.boundSourceUrls).toContain(url);
});

it("never promotes discovery snippets into verified travel plans when the page read fails", async () => {
  const tools = productionServerTools({ external: { readWebPages: vi.fn(async () => { throw Error("unavailable"); }) },
    discovery: vi.fn(async () => ({ body: { discovery: { batch: { hits: [{ hitId: "hit-1", sourceRef: "https://example.org/lead",
      retrievalChannel: "web", text: "検索結果" }] } } } })), accommodation: vi.fn(), journey: vi.fn() });
  const search = tools.find((tool) => tool.descriptor.name === "search_travel_knowledge")!;
  const response = await search.operation({}, { requestId: "consultation" });
  const evidence = search.evidence(response.body, evidenceContext);
  expect(evidence).toHaveLength(1);
  expect(evidence.some(item => item.facts.sourcePrecision === "read-page")).toBe(false);
});

it("reads search_web hits before presenting them as verified sources", async () => {
  const url = "https://example.org/history";
  const tools = productionServerTools({ external: { searchWeb: vi.fn(async () => ({ webSearch: { status: "available", freshness: "fresh",
    data: { query: "歴史", results: [{ id: "hit", title: "歴史", url, description: "候補" }] },
    evidence: [{ id: "search-hit", provider: "web", sourceUrl: url }] } })),
  readWebPages: vi.fn(async () => ({ webPages: { status: "available", freshness: "fresh",
    data: { pages: [{ url, title: "観光資料", text: "歴史的な町並みを紹介しています。" }] },
    evidence: [{ id: "read-page", provider: "safe-reader", sourceUrl: url }] } })) }, accommodation: vi.fn(), journey: vi.fn() });
  const search = tools.find((tool) => tool.descriptor.name === "search_web")!;
  const response = await search.operation({ query: "歴史" }, { requestId: "consultation" });
  const evidence = search.evidence(response.body, { ...evidenceContext, toolName: "search_web" });
  expect(evidence.filter(item => item.facts.sourcePrecision === "read-page")).toHaveLength(1);
  expect(evidence.find(item => item.facts.sourcePrecision === "read-page")?.facts.sourcePrecision).toBe("read-page");
});

it("compares only a verified journey result from the same server turn", async () => {
  const result = { serviceDate: "2026-09-24", originStation: "京都", destinationStation: "出雲市", searchTimeMinutes: 480, totalMatchCount: 1, matches: [], journeys: [{ departureTimeMinutes: 480, arrivalTimeMinutes: 720, transferCount: 1, legs: [{ serviceUid: "s1", trainNumber: "1M", serviceType: "特急", trainName: "やくも", originStation: "岡山", destinationStation: "出雲市", departureTimeMinutes: 540, arrivalTimeMinutes: 720, scheduledDepartureTimeMinutes: 540, scheduledArrivalTimeMinutes: 720, delayMinutes: 0 }] }] };
  const captured: typeof result[] = [];
  const bindings = productionServerTools({ external: {}, accommodation: vi.fn(), journey: vi.fn(async () => ({ body: result })), onJourneyResult: value => captured.push(value as typeof result) });
  const search = bindings.find(binding => binding.descriptor.name === "search_journeys")!;
  const searched = await search.operation({}, { requestId: "execution" });
  expect(searched.body.searchResultId).toBe("journey-search-1"); expect(captured).toHaveLength(1);
  const compare = bindings.find(binding => binding.descriptor.name === "compare_journeys")!;
  await expect(compare.operation({ searchResultId: "foreign" }, { requestId: "execution" })).resolves.toMatchObject({ statusCode: 404 });
  await expect(compare.operation({ searchResultId: "journey-search-1" }, { requestId: "execution" })).resolves.toMatchObject({ body: { source: "verified-journey-search-result", candidates: [{ candidateId: "journey-1" }] } });
});

it("restores a Trip without Profile, invokes fixed-egress through the existing operation, and persists the grounded final", async () => {
  const state = stateDynamoFixture(), trips = tripDynamoFixture();
  await trips.repository.create(stateA, createTrip(secondId, "server trip", "2026-09-18T00:00:00Z"));
  await state.conversations.create(stateA, conversationId, stateMetadata());
  const search = vi.fn(async () => [{ kind: "accommodation" as const, provider: "travel-provider", providerItemId: "42", name: "宿",
    checkInDate: "2026-10-01", checkOutDate: "2026-10-02", availability: "unknown" as const }]);
  const provider = createFixedEgressProviderHandler({ search });
  const invoke = vi.fn(async (input: { Payload: Uint8Array }) => ({ StatusCode: 200,
    Payload: new TextEncoder().encode(JSON.stringify(await provider(JSON.parse(new TextDecoder().decode(input.Payload))))) }));
  const { model, runRuntime } = strandsScriptedRuntime([
    { name: "search_accommodations", input: { destination: "京都", checkInDate: "2026-10-01", checkOutDate: "2026-10-02" } },
    { name: "strands_structured_output", input: { reply: { kind: "answer", commentary: "宿泊候補です。空室は未確認です。",
      references: [{ evidenceId: "observation:execution:fixture-1:search_accommodations:q-8232276c:accommodation:travel-provider:42", field: "accommodationSummary" }] } } },
  ]);
  const app = createProductionConversationAgent({ stateTable: "test-state", tripTable: "test-trips", stateClient: state.client, tripClient: trips.client,
    runRuntime, weather: { search: vi.fn() }, newExecutionId: () => "execution",
    additionalTools: productionServerTools({ external: {}, accommodation: createFixedEgressAccommodationOperation("provider-arn", { invoke }), journey: vi.fn() }),
  });
  const request = { principal: stateA, conversationId, turnId: secondId, tripId: secondId, userRequest: "京都の宿を調べたい" };
  const final = await app.runConversationTurn(request);
  expect(final.publicAccommodationPresentation?.cards).toEqual(expect.arrayContaining([expect.objectContaining({ name: "宿" })])); expect(final.response).not.toContain("decision_summary");
  expect(invoke).toHaveBeenCalledTimes(1); expect(search).toHaveBeenCalledWith(expect.objectContaining({ destination: "京都", adults: 1 }), "execution");
  expect(model.calls).toBe(2);
  expect(JSON.stringify(invoke.mock.calls)).not.toMatch(/principal|Bearer|profile/);
  expect((await state.conversations.history(stateA, conversationId)).items.map(m => m.role)).toEqual(["user", "assistant"]);
  expect(await app.runConversationTurn(request)).toEqual(final); expect(invoke).toHaveBeenCalledTimes(1); expect(model.calls).toBe(2);
});
