import { expect, it, vi } from "vitest";
import { createTrip } from "@raiquora/trip/trip";
import { stateDynamoFixture, stateA, conversationId, stateMetadata } from "../adapters/state-dynamodb.fixture.js";
import { tripDynamoFixture } from "../adapters/trip-dynamodb.fixture.js";
import { StrandsAgentEngine, strandsProductionReasoning } from "../adapters/strands-agent-engine.js";
import { StrandsScriptedModel } from "../adapters/strands-scripted-model.fixture.js";
import { createStrandsServerRuntime } from "../adapters/strands-server-runtime.js";
import { createConversationServerAgent } from "./conversation-server-agent.js";
import { agentV2SystemPrompt } from "../usecases/agent-v2-system-prompt.js";
import { stableSelectionMutation } from "../usecases/agent/presented-candidate-selection.js";
import { searchJourneyIndex } from "@raiquora/journey/journey-search-engine";
import { projectPublicJourneyPresentation } from "@raiquora/agent/public-journey-presentation";
import { productionServerTools } from "./production-server-tools.js";
import { VerifiedJourneySelections } from "../usecases/verified-journey-selection.js";

const live = process.env.AGENT_V2_LIVE === "true";
const settings = { modelId: process.env.MODEL_ID ?? "jp.anthropic.claude-sonnet-4-6", region: "ap-northeast-1", systemPrompt: agentV2SystemPrompt,
  maxTurns: 6, maxOutputTokens: 4096, maxInvocationOutputTokens: 4096, ...strandsProductionReasoning(process.env.MODEL_ID ?? "jp.anthropic.claude-sonnet-4-6") };
const output = (reply: unknown) => ({ name: "strands_structured_output", input: { reply } });
type Mode = "empty" | "single" | "multiple" | "named" | "negated" | "hypothetical";
const steps = (mode: Mode) => mode === "negated" || mode === "hypothetical" ? [output({ kind: "conversation", message: "acknowledgement", text: "案は保存せず、相談を続けます。" })] : mode === "empty" ? [output({ kind: "clarification", target: "itinerary_target", text: "保存する候補はまだありません。旅程画面で相談したい予定や追加箇所を選んでください。" })] : mode === "multiple" ? [
  { name: "review_presented_candidates", input: { presentationId: "shown:2:plan" } }, output({ kind: "clarification", target: "candidate_selection", text: "案が複数あります。どの案にしますか？" }),
] : [{ name: "select_presented_candidate", input: { presentationId: "shown:2:plan", candidateId: mode === "named" ? "plan-2" : "plan-1", quote: mode === "named" ? "案2でお願いします" : "この案を保存して", reference: mode === "named" ? { kind: "ordinal", ordinal: 2, quote: "2" } : { kind: "sole" } } },
  output({ kind: "operation_result", receiptId: stableSelectionMutation(conversationId, 3) })];
it.each(["empty", "single", "multiple", "named", "negated", "hypothetical"] as const)(`#784 ${live ? "Bedrock" : "SDK"} selection %s preserves state/history/replay`, async mode => {
  const state = stateDynamoFixture(), trips = tripDynamoFixture(), metadata = stateMetadata();
  trips.seed(createTrip(metadata.tripId, "選択検証", "2026-10-04T00:00:00Z"), stateA.subject);
  await state.conversations.create(stateA, conversationId, metadata);
  const prelude = createStrandsServerRuntime(new StrandsAgentEngine(settings, { model: new StrandsScriptedModel([
    { name: "draft_itinerary", input: { variants: Array.from({ length: mode === "single" ? 1 : 2 }, (_, index) => ({
      label: `案${index + 1}`, dayCount: 1, items: [{ kind: "activity", title: `活動${index + 1}`, day: 1 }] })), unknowns: ["時刻は未確認"] } },
    output({ kind: "conversation", message: "acknowledgement", text: "旅程案です。どの案にしますか？" }),
  ]) }));
  let inputSeen: Parameters<ReturnType<typeof createStrandsServerRuntime>>[0] | undefined;
  let proof: unknown, calls = 0;
  const selected = createStrandsServerRuntime(new StrandsAgentEngine(settings, live ? {} : { model: new StrandsScriptedModel(steps(mode)) }));
  let isPrelude = true, execution = 0;
  const app = createConversationServerAgent({ stateTable: "test-state", tripTable: "test-trips", stateClient: state.client, tripClient: trips.client,
    model: { converse: vi.fn(async () => { throw Error("legacy runtime called"); }) }, weather: { search: vi.fn() },
    newExecutionId: () => `78400000-2222-4000-8000-${String(++execution).padStart(12, "0")}`,
    runRuntime: async input => { if (isPrelude) return prelude(input); calls++; inputSeen = input; const result = await selected(input); proof = result.publicReply;
      if (live) console.log(JSON.stringify({ mode, phase: "selection-reply", status: result.status, kind: result.publicReply?.kind, question: result.publicReply?.question,
        committed: !!result.tripMutationReceipt, publicationError: result.publicationError }));
      return result; },
    limits: { maxIterations: 6, maxModelCalls: 6, maxToolCalls: 3, maxExecutionMs: 60000 },
  });
  let plan;
  if (mode !== "empty") plan = await app.runConversationTurn({ principal: stateA, conversationId, turnId: "78400000-1111-4000-8000-000000000001", userRequest: "旅程案を作って" });
  isPrelude = false;
  const userRequest = mode === "empty" ? "この条件を保存して" : mode === "named" ? "案2でお願いします" : mode === "negated" ? "案2は保存しないでください。" : mode === "hypothetical" ? "仮に案2を選ぶとしたらどう思いますか。まだ保存しないでください。" : "この案を保存して";
  const request = { principal: stateA, conversationId, turnId: "78400000-1111-4000-8000-000000000002", userRequest };
  const result = await app.runConversationTurn(request);
  expect(result.status).toBe("completed");
  expect(inputSeen?.candidateController?.context.groups.length).toBe(mode === "empty" ? 0 : 1);
  expect(await app.runConversationTurn(request)).toEqual(result); expect(calls).toBe(1);
  const saved = await trips.repository.get(stateA, metadata.tripId);
  if (mode === "empty") { expect(proof).toMatchObject({ kind: "clarification", question: "itinerary_target" }); expect(saved?.items).toEqual([]); }
  else if (mode === "multiple") {
    expect(proof).toMatchObject({ kind: "clarification", question: "candidate_selection" }); expect(result.publicPlanPresentation).toEqual(plan?.publicPlanPresentation); expect(saved?.items).toEqual([]);
  } else if (mode === "negated" || mode === "hypothetical") {
    expect(saved?.items).toEqual([]); expect(result.tripMutationReceipt).toBeUndefined();
    expect(proof).not.toMatchObject({ kind: "operation_result" });
  } else {
    expect(proof).toMatchObject({ kind: "operation_result", operation: { type: "save", status: "succeeded" } });
    expect(saved?.items.map(item => item.title)).toEqual([mode === "named" ? "活動2" : "活動1"]);
    expect(result.tripMutationReceipt).toMatchObject({ tripId: metadata.tripId, tripRevision: saved?.revision });
  }
  const history = await state.conversations.history(stateA, conversationId);
  expect(history.items.at(-1)?.tripMutationReceipt).toEqual(result.tripMutationReceipt);
  expect(history.items.at(-1)?.publicPlanPresentation).toEqual(result.publicPlanPresentation);
}, 90000);

it(`#784 ${live ? "Bedrock" : "SDK"} route choice saves the shown scheduled service without searching again`, async () => {
  const state = stateDynamoFixture(), trips = tripDynamoFixture(), metadata = stateMetadata();
  trips.seed(createTrip(metadata.tripId, "経路選択", "2026-10-04T00:00:00Z"), stateA.subject);
  await state.conversations.create(stateA, conversationId, metadata);
  const index = { schema_version: "direct-service-index-v1", service_date: "2026-10-04", services: {
    direct: { service_uid: "direct", train_no: "10M", service_type: "普通", train_name: "", origin_station: "向日町", destination_station: "出雲市",
      calls: [{ station_name: "向日町", departure_time_minutes: 600 }, { station_name: "出雲市", arrival_time_minutes: 640 }] },
    later: { service_uid: "later", train_no: "11M", service_type: "普通", train_name: "", origin_station: "向日町", destination_station: "出雲市",
      calls: [{ station_name: "向日町", departure_time_minutes: 700 }, { station_name: "出雲市", arrival_time_minutes: 740 }] },
  } };
  const rail = searchJourneyIndex({ serviceDate: index.service_date, originStation: "向日町", destinationStation: "出雲市", departureTimeMinutes: 600, maxTransfers: 0, limit: 3 }, { index });
  const selections = new VerifiedJourneySelections(); selections.record(rail, index, "2026-10-04T00:00:00Z");
  const journey = vi.fn(async () => ({ body: JSON.parse(JSON.stringify(rail)) }));
  const bindings = productionServerTools({ external: {}, accommodation: vi.fn(), journey });
  const prelude = createStrandsServerRuntime(new StrandsAgentEngine(settings, { model: new StrandsScriptedModel([
    { name: "search_journeys", input: { serviceDate: rail.serviceDate, originStation: rail.originStation, destinationStation: rail.destinationStation, departureTimeMinutes: 600 } },
    output({ kind: "answer", references: [{ evidenceId: "journey:2026-10-04:0", field: "departureTimeMinutes" }, { evidenceId: "journey:2026-10-04:1", field: "departureTimeMinutes" }], commentary: "経路候補です。どちらにしますか？" }),
  ]) }));
  const selected = createStrandsServerRuntime(new StrandsAgentEngine(settings, live ? {} : { model: new StrandsScriptedModel([
    { name: "select_presented_candidate", input: { presentationId: "shown:2:journey", candidateId: "journey-2", quote: "経路2でお願いします", reference: { kind: "ordinal", ordinal: 2, quote: "2" } } },
    output({ kind: "operation_result", receiptId: stableSelectionMutation(conversationId, 3) }),
  ]) }));
  let isPrelude = true, execution = 0;
  const app = createConversationServerAgent({ stateTable: "test-state", tripTable: "test-trips", stateClient: state.client, tripClient: trips.client,
    model: { converse: vi.fn(async () => { throw Error("legacy runtime called"); }) }, weather: { search: vi.fn() }, additionalTools: bindings,
    newExecutionId: () => `78400000-2222-4000-8000-${String(++execution).padStart(12, "0")}`,
    runRuntime: input => isPrelude ? prelude(input) : selected(input),
    projectResult: result => isPrelude ? { publicJourneyPresentation: projectPublicJourneyPresentation(rail, new Set(result.claims.flatMap(claim => claim.evidenceIds))) } : {},
    verifiedSearchSelectionItems: result => selections.itemsFor(result.publicJourneyPresentation),
    limits: { maxIterations: 6, maxModelCalls: 6, maxToolCalls: 3, maxExecutionMs: 60000 },
  });
  const shown = await app.runConversationTurn({ principal: stateA, conversationId, turnId: "78400000-1111-4000-8000-000000000001", userRequest: "今日の10時以降、向日町から出雲市への経路を検索して" });
  expect(shown.publicJourneyPresentation?.journeys).toHaveLength(2); expect(shown.publicPlanPresentation?.candidates).toHaveLength(2);
  isPrelude = false;
  const request = { principal: stateA, conversationId, turnId: "78400000-1111-4000-8000-000000000002", userRequest: "経路2でお願いします" };
  const result = await app.runConversationTurn(request);
  expect(result.status).toBe("completed"); expect(result.tripMutationReceipt).toBeDefined();
  expect(journey).toHaveBeenCalledOnce();
  const saved = await trips.repository.get(stateA, metadata.tripId);
  expect(saved?.items).toHaveLength(1); expect(saved?.items[0]).toMatchObject({ type: "transport", detail: { journey: { legs: [{ serviceUid: "later", trainNumber: "11M" }] } } });
  expect(await app.runConversationTurn(request)).toEqual(result); expect(journey).toHaveBeenCalledOnce();
}, 90000);
