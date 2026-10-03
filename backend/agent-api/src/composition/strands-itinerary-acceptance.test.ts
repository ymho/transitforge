import { expect, it, vi } from "vitest";
import { Agent, BedrockModel, Model, ModelMessageEvent, BeforeToolCallEvent, ToolResultEvent, type BaseModelConfig, type Message, type ModelStreamEvent } from "@strands-agents/sdk";
import { createTrip } from "@raiquora/trip/trip";
import { stateDynamoFixture, stateA, conversationId, stateMetadata } from "../adapters/state-dynamodb.fixture.js";
import { tripDynamoFixture } from "../adapters/trip-dynamodb.fixture.js";
import { StrandsAgentEngine } from "../adapters/strands-agent-engine.js";
import { createStrandsServerRuntime } from "../adapters/strands-server-runtime.js";
import { createConversationServerAgent } from "./conversation-server-agent.js";
import { agentV2SystemPrompt } from "../usecases/agent-v2-system-prompt.js";
import { productionServerTools } from "./production-server-tools.js";
import type { AgentOperation } from "../ports/agent-operation.js";
import { projectPublicJourneyPresentation } from "@raiquora/agent/public-journey-presentation";
import { DynamoDbItineraryCandidateRepository } from "../adapters/dynamodb-itinerary-candidate-repository.js";
import { PlanCandidateAdoptionApplication } from "../usecases/plan-candidate-adoption.js";
import { TripApplication } from "../usecases/trip-application.js";
import { DynamoDbTripRepository } from "../adapters/dynamodb-trip-repository.js";

/** The first two assistant replies are fixed to the reported confirmation question.
 * Otherwise a free model may ask about origin instead, changing what "はい" accepts.
 * The third turn is real Bedrock only in the paid lane; state is always synthetic. */
class ScriptModel extends Model<BaseModelConfig> {
  private config: BaseModelConfig = { modelId: "synthetic-itinerary" };
  private cursor = 0;
  constructor(private readonly steps: { name: string; input: unknown }[]) { super(); }
  updateConfig(config: BaseModelConfig) { this.config = { ...this.config, ...config }; }
  getConfig() { return this.config; }
  async *stream(_messages: Message[]): AsyncGenerator<ModelStreamEvent> {
    const step = this.steps[this.cursor++];
    if (!step) throw Error("Unexpected additional model call");
    yield { type: "modelMessageStartEvent", role: "assistant" };
    yield { type: "modelContentBlockStartEvent", start: { type: "toolUseStart", name: step.name, toolUseId: `fixture-${this.cursor}` } };
    yield { type: "modelContentBlockDeltaEvent", delta: { type: "toolUseInputDelta", input: JSON.stringify(step.input) } };
    yield { type: "modelContentBlockStopEvent" };
    yield { type: "modelMessageStopEvent", stopReason: "toolUse" };
  }
}
const reply = (text: string) => ({ name: "strands_structured_output", input: { reply: { kind: "conversation", message: "acknowledgement", text } } });
const live = process.env.AGENT_V2_LIVE === "true";
// Evaluation comparison only: production stays on Nova until the same bounded
// acceptance cases pass. Native adaptive thinking uses the existing output budget.
function comparisonModel(modelId: string): Model<BaseModelConfig> | undefined {
  return modelId === "jp.anthropic.claude-sonnet-4-6" ? new BedrockModel({ modelId, region: "ap-northeast-1",
    maxTokens: 4096, stream: false,
    additionalRequestFields: { thinking: { type: "adaptive" }, output_config: { effort: "medium" } },
  }) : undefined;
}
it(`completes the exact confirmation turn with ${live ? "Bedrock" : "scripted SDK"}, retaining cards and replay`, async () => {
  const state = stateDynamoFixture(), trips = tripDynamoFixture(), metadata = stateMetadata();
  trips.seed(createTrip(metadata.tripId, "相談中の旅", "2026-10-03T00:00:00Z"), stateA.subject);
  await state.conversations.create(stateA, conversationId, metadata);
  const modelId = process.env.MODEL_ID ?? "jp.amazon.nova-2-lite-v1:0";
  const settings = { modelId, ...(modelId === "jp.amazon.nova-2-lite-v1:0" ? { novaReasoningEffort: "low" as const } : {}), region: "ap-northeast-1", systemPrompt: agentV2SystemPrompt,
    maxTurns: 6, maxOutputTokens: 4096, maxInvocationOutputTokens: 4096 };
  const prelude = createStrandsServerRuntime(new StrandsAgentEngine(settings, { model: new ScriptModel([
    { name: "update_current_destination", input: { action: "set", place: "出雲大社", quote: "出雲大社にいきたい" } }, reply("行き先を出雲大社として受け止めました。"),
    { name: "update_current_travel_period", input: { action: "set", period: { start: { kind: "relative_date", relation: "tomorrow" }, duration: { unit: "nights", amount: 1 } }, quote: "明日から1泊で行きたい" } },
    reply("旅行期間を明日から1泊に設定しました。出雲大社の観光プランを作成しましょうか？"),
  ]) }));
  const finalRuntime = createStrandsServerRuntime(new StrandsAgentEngine(settings, live ? { model: comparisonModel(modelId) } : { model: new ScriptModel([
    { name: "draft_itinerary", input: { variants: [{ label: "1泊の仮旅程", dayCount: 1, items: [
      { kind: "activity", title: "出雲大社の参拝", day: 1 },
      { kind: "stay", title: "宿泊先は未選択", day: 1, endDay: 2 },
      { kind: "transport", title: "帰路は未選択", day: 2 },
    ] }], unknowns: ["移動時刻と宿泊先は未確認"] } }, reply("仮旅程を作成しました。"),
  ]) }));
  let index = 0, execution = 0;
  const app = createConversationServerAgent({ stateTable: "test-state", tripTable: "test-trips", stateClient: state.client, tripClient: trips.client,
    model: { converse: vi.fn(async () => { throw Error("legacy runtime called"); }) }, weather: { search: vi.fn() },
    newExecutionId: () => `78300000-2222-4000-8000-${String(++execution).padStart(12, "0")}`, runRuntime: input => index < 2 ? prelude(input) : finalRuntime(input),
    limits: { maxIterations: 6, maxModelCalls: 6, maxToolCalls: 2, maxExecutionMs: 60000 },
    diagnostics: { record: async event => { if (live && (event.phase === "execution" || event.phase === "tool")) console.log(JSON.stringify({ phase: "confirmation", reason: event.reason, counts: event.counts, code: event.toolErrorCode })); } },
  });
  for (const userRequest of ["出雲大社にいきたい", "明日から1泊で行きたい", "はい、作成お願いします。"]) {
    const turn = { principal: stateA, conversationId, turnId: `78300000-1111-4000-8000-${String(index + 1).padStart(12, "0")}`, userRequest, uiContext: { calendarDate: "2026-10-03" } };
    const result = await app.runConversationTurn(turn);
    expect(result.status).toBe("completed");
    expect(await app.runConversationTurn(turn)).toEqual(result);
    if (index === 2) {
      const plan = result.publicPlanPresentation!;
      expect(plan.researchOutcome.budget.modelCalls).toBeGreaterThan(0);
      expect(plan?.candidateSetRef.kind).toBe("candidate-set-ref");
      expect(plan.target).toEqual({ tripId: metadata.tripId, baseTripRevision: (await trips.repository.get(stateA, metadata.tripId))!.revision });
      expect(plan.candidates[0]!.days).toHaveLength(2);
      expect(plan.candidates[0]!.items.some(item => item.title.includes("出雲大社"))).toBe(true);
      expect(plan.candidates[0]!.unknowns.length).toBeGreaterThan(0);
      expect((await trips.repository.get(stateA, metadata.tripId))!.items).toEqual([]);
    }
    index++;
  }
  expect((await state.conversations.history(stateA, conversationId)).items).toHaveLength(6);
}, 90_000);

it(`connects hotel comparison, same-turn origin/draft, rail cards, adoption and replay with ${live ? "Bedrock" : "scripted SDK"}`, async () => {
  const state = stateDynamoFixture(), trips = tripDynamoFixture(), metadata = stateMetadata();
  trips.seed(createTrip(metadata.tripId, "出雲旅行", "2026-10-03T00:00:00Z"), stateA.subject);
  await state.conversations.create(stateA, conversationId, metadata);
  const modelId = process.env.MODEL_ID ?? "jp.amazon.nova-2-lite-v1:0";
  const settings = { modelId, ...(modelId === "jp.amazon.nova-2-lite-v1:0" ? { novaReasoningEffort: "low" as const } : {}), region: "ap-northeast-1", systemPrompt: agentV2SystemPrompt,
    maxTurns: 8, maxOutputTokens: 4096, maxInvocationOutputTokens: 4096 };
  const scripts = [
    [{ name: "update_current_destination", input: { action: "set", place: "出雲大社", quote: "出雲大社にいきたい" } }, reply("出雲大社へ行く希望を受け止めました。アクセス駅は出雲市駅で調べられます。")],
    [{ name: "update_current_travel_period", input: { action: "set", period: { start: { kind: "relative_date", relation: "tomorrow" }, duration: { unit: "nights", amount: 1 } }, quote: "明日から1泊で行きたい" } }, reply("出雲大社へのアクセスや宿泊施設の提案が必要ですか？")],
    [{ name: "search_accommodations", input: { destination: "出雲大社", checkInDate: "2026-10-04", checkOutDate: "2026-10-05", adults: 1, limit: 3 } },
      { name: "strands_structured_output", input: { reply: { kind: "answer", commentary: "検索用に大人1名を仮定した宿泊候補です。", references: [{ evidenceId: "hotel-1", field: "name" }] } } }],
    [{ name: "strands_structured_output", input: { reply: { kind: "clarification", target: "origin", text: "電車を検索するため出発駅を教えてください。" } } }],
    [{ name: "update_current_origin", input: { action: "set", place: "向日町駅", quote: "向日町駅" } },
      { name: "draft_itinerary", input: { variants: [{ label: "1泊の旅程案", dayCount: 2, items: [{ kind: "transport", title: "向日町からの往路（未選択）", day: 1 },
        { kind: "activity", title: "出雲大社を参拝", day: 1 }, { kind: "stay", title: "出雲周辺に宿泊（未選択）", day: 1, endDay: 2 }, { kind: "transport", title: "帰路（未選択）", day: 2 }] }], unknowns: ["出発時刻と経路・宿泊先は未選択"] } }, reply("旅程案を作成しました。出発時刻は何時ごろですか？")],
    [{ name: "search_journeys", input: { serviceDate: "2026-10-04", originStation: "向日町駅", destinationStation: "出雲市駅", departureTimeMinutes: 480 } },
      { name: "strands_structured_output", input: { reply: { kind: "answer", commentary: "指定の想定時刻で検索した経路候補です。", references: [{ evidenceId: "journey:2026-10-04:0", field: "departureTimeMinutes" }] } } }],
  ];
  const rail = { serviceDate: "2026-10-04", originStation: "向日町", destinationStation: "出雲市", searchTimeMinutes: 480, totalMatchCount: 1, matches: [], journeys: [
    { departureTimeMinutes: 480, arrivalTimeMinutes: 780, transferCount: 1, legs: [
      { serviceUid: "local", trainNumber: "", serviceType: "普通", trainName: "", originStation: "向日町", destinationStation: "岡山", departureTimeMinutes: 480, arrivalTimeMinutes: 600, scheduledDepartureTimeMinutes: 480, scheduledArrivalTimeMinutes: 600, delayMinutes: 0 },
      { serviceUid: "yakumo", trainNumber: "1M", serviceType: "特急", trainName: "やくも", originStation: "岡山", destinationStation: "出雲市", departureTimeMinutes: 630, arrivalTimeMinutes: 780, scheduledDepartureTimeMinutes: 630, scheduledArrivalTimeMinutes: 780, delayMinutes: 0 },
    ] },
  ] };
  const accommodation = vi.fn(async () => ({ body: { accommodations: [1, 2, 3].map(id => ({ kind: "accommodation", provider: "fixture", providerItemId: String(id), name: `比較用の宿${id}`,
    checkInDate: "2026-10-04", checkOutDate: "2026-10-05", availability: id === 1 ? "available" : "unknown", bookingUrl: `https://example.org/hotels/${id}`,
    price: { price: { currency: "JPY", amountMinor: 5100 }, observedAt: "2026-10-03T00:00:00Z", basis: "reference-minimum" } })) } }));
  const journey = vi.fn<AgentOperation>(async () => ({ body: rail }));
  const bindings = productionServerTools({ external: {}, accommodation, journey });
  const hotelBinding = bindings.find(binding => binding.descriptor.name === "search_accommodations")!;
  const originalEvidence = hotelBinding.evidence;
  // Scripted replies use short predetermined IDs. Live calls keep the real
  // observation identity so a later search cannot collide with earlier evidence.
  if (!live) hotelBinding.evidence = (output, context) => originalEvidence(output, context).map((evidence, index) => ({ ...evidence, id: `hotel-${index + 1}` }));
  let index = 0, execution = 0;
  const app = createConversationServerAgent({ stateTable: "test-state", tripTable: "test-trips", stateClient: state.client, tripClient: trips.client,
    model: { converse: vi.fn(async () => { throw Error("legacy runtime called"); }) }, weather: { search: vi.fn() }, additionalTools: bindings,
    newExecutionId: () => `78500000-2222-4000-8000-${String(++execution).padStart(12, "0")}`,
    runRuntime: input => {
      if (index === 2) expect(input.context?.conversation?.messages?.at(-1)?.text).toContain("宿泊施設の提案");
      if (index === 4) expect(input.context?.conversation?.messages?.at(-1)?.text).toContain("出発駅");
      return createStrandsServerRuntime(new StrandsAgentEngine(settings, live && [2, 4, 5].includes(index) ? { model: comparisonModel(modelId), createAgent: config => {
      const agent = new Agent(config);
      console.log(JSON.stringify({ turn: index + 1, phase: "consultation-capabilities", tools: agent.tools.map(tool => tool.name) }));
      agent.addHook(ModelMessageEvent, ({ stopReason, message }) => console.log(JSON.stringify({ turn: index + 1, phase: "consultation-model", stopReason,
        tools: message.content.flatMap(block => block.type === "toolUseBlock" ? [block.name] : []),
        replies: message.content.flatMap(block => block.type === "toolUseBlock" && block.name === "strands_structured_output" && block.input && typeof block.input === "object" && "reply" in block.input && block.input.reply && typeof block.input.reply === "object" && "kind" in block.input.reply
          ? [typeof block.input.reply.kind === "string" && ["answer", "candidates", "conversation", "clarification", "unavailable", "operation_result", "uncertainty"].includes(block.input.reply.kind) ? block.input.reply.kind : "unknown"] : []) })));
      agent.addHook(BeforeToolCallEvent, ({ toolUse }) => {
        if (!toolUse.name.startsWith("update_current_")) return;
        const value = toolUse.input;
        const quote = value && typeof value === "object" && "quote" in value && typeof value.quote === "string" ? value.quote : undefined;
        const place = value && typeof value === "object" && "place" in value && typeof value.place === "string" ? value.place : undefined;
        console.log(JSON.stringify({ turn: index + 1, phase: "consultation-condition-source", tool: toolUse.name,
          quoteInCurrent: quote === undefined ? false : input.userRequest.includes(quote),
          quoteInHistory: quote === undefined ? false : (input.context?.conversation?.messages ?? []).some(message => message.text.includes(quote)),
          placeInQuote: place === undefined ? undefined : quote?.includes(place) ?? false }));
      });
      agent.addHook(ToolResultEvent, ({ result }) => console.log(JSON.stringify({ turn: index + 1, phase: "consultation-tool", status: result.status,
        errors: closedToolErrors(result.error), fields: closedIssueFields(result.error) })));
      return agent;
    } } : { model: new ScriptModel(scripts[index]!) }))(input);
    },
    projectResult: result => ({ ...(index === 5 ? { publicJourneyPresentation: projectPublicJourneyPresentation(rail,
      new Set(result.claims.filter(claim => claim.groundingStatus === "supported").flatMap(claim => claim.evidenceIds))) } : {}) }),
    limits: { maxIterations: 8, maxModelCalls: 8, maxToolCalls: 4, maxExecutionMs: 90000 },
    diagnostics: { record: async event => { if (live && ["execution", "runtime", "tool"].includes(event.phase)) console.log(JSON.stringify({ turn: index + 1, phase: event.phase, reason: event.reason, mode: event.mode, counts: event.counts, tool: event.refs, code: event.toolErrorCode })); } },
  });
  let plan: NonNullable<Awaited<ReturnType<typeof app.runConversationTurn>>["publicPlanPresentation"]> | undefined;
  for (const userRequest of ["出雲大社にいきたい", "明日から1泊で行きたい", "はい、お願いします", "電車も検索してください", "向日町駅\n旅程に反映しておいてください。", "午前8時に向日町駅を出発する想定で、出雲市駅まで電車を検索してください"]) {
    const input = { principal: stateA, conversationId, turnId: `78500000-1111-4000-8000-${String(index + 1).padStart(12, "0")}`, userRequest, uiContext: { calendarDate: "2026-10-03" } };
    const result = await app.runConversationTurn(input);
    expect(result.status).toBe("completed"); expect(await app.runConversationTurn(input)).toEqual(result);
    if (index === 2) { expect.soft(accommodation).toHaveBeenCalled(); expect.soft(result.publicAccommodationPresentation?.cards).toHaveLength(3); }
    if (index === 4) {
      // No departure time has been supplied. The requested draft must remain
      // usable without inventing a time for a rail search.
      expect(journey).not.toHaveBeenCalled();
      plan = result.publicPlanPresentation!;
      expect(plan?.candidates[0]?.days).toHaveLength(2);
      expect(plan?.target).toEqual({ tripId: metadata.tripId, baseTripRevision: (await trips.repository.get(stateA, metadata.tripId))!.revision });
    }
    if (index === 5) {
      expect(journey).toHaveBeenCalledWith(expect.objectContaining({ serviceDate: "2026-10-04",
        originStation: expect.stringMatching(/^向日町(?:駅)?$/u), destinationStation: expect.stringMatching(/^出雲市(?:駅)?$/u), departureTimeMinutes: 480 }), expect.anything());
      expect(result.publicJourneyPresentation?.journeys[0]?.legs[0]?.trainName).toBe("");
    }
    expect((await trips.repository.get(stateA, metadata.tripId))!.items).toEqual([]);
    index++;
  }
  const candidateRef = plan!.candidateSetRef; if (candidateRef.kind !== "candidate-set-ref") throw Error("Retained candidate missing");
  const candidates = new DynamoDbItineraryCandidateRepository("test-trips", trips.client);
  const durableTrips = new DynamoDbTripRepository("test-trips", trips.client);
  const tripApplication = new TripApplication(durableTrips, durableTrips);
  const adoption = new PlanCandidateAdoptionApplication(candidates, durableTrips, candidates, tripApplication, draft => {
    const base = { id: `adopted-${draft.componentId}`, title: draft.title, schedule: draft.schedule };
    return draft.kind === "activity" ? { ...base, type: "activity", category: "sightseeing" } : draft.kind === "stay" ? { ...base, type: "stay", selection: { status: "unselected" } }
      : { ...base, type: "transport", detail: { status: "unresolved" } };
  });
  const target = { conversationId, candidateSetId: candidateRef.candidateSetId, candidateSetRevision: candidateRef.revision, variantId: plan!.candidates[0]!.variantId,
    tripId: metadata.tripId, baseTripRevision: plan!.target!.baseTripRevision, mutationId: "78500000-3333-4000-8000-000000000001" };
  const preview = await adoption.execute(stateA, { ...target, operation: "preview" });
  if (preview.status !== "confirmation-required") throw Error("Preview missing");
  expect(preview.preview.changes.added).toBeGreaterThanOrEqual(3);
  const saved = await adoption.execute(stateA, { ...target, operation: "confirm" }, { confirmationKey: preview.confirmationKey });
  expect(saved.status).toBe("saved");
  expect((await trips.repository.get(stateA, metadata.tripId))!.items.length).toBeGreaterThanOrEqual(3);
  const history = (await state.conversations.history(stateA, conversationId)).items;
  expect(history).toHaveLength(12); expect.soft(history[5]?.publicAccommodationPresentation?.cards).toHaveLength(3);
}, 300_000);

/** Diagnostics contain known rejection codes only, never SDK error bodies. */
function closedToolErrors(error: Error | undefined): string[] {
  if (!error) return [];
  const codes = ["invalid_proposal", "missing_evidence", "ineligible_evidence", "invalid_field", "known_condition", "operation_available", "invalid_receipt", "unsafe_content", "evidence_collision", "invalid_source", "invalid_condition", "condition_conflict"];
  const direct = codes.find(code => error.message === code || error.message.startsWith(`${code}:`));
  if (direct) return [direct];
  if (!("issues" in error) || !Array.isArray(error.issues)) return ["tool_error"];
  return [...new Set(error.issues.map((issue: unknown) => {
    if (!issue || typeof issue !== "object" || !("message" in issue) || typeof issue.message !== "string") return "schema_validation";
    const message = issue.message;
    return codes.find(code => message.startsWith(`${code}:`)) ?? "schema_validation";
  }))];
}

/** Field names only; never validation values or model-generated path components. */
function closedIssueFields(error: Error | undefined): string[] {
  if (!error || !("issues" in error) || !Array.isArray(error.issues)) return [];
  const allowed = ["reply", "kind", "target", "nextQuestion", "references", "evidenceId", "field", "sections", "heading", "text", "commentary", "evidenceIds", "operation", "receiptId"];
  return [...new Set(error.issues.flatMap((issue: unknown) => {
    if (!issue || typeof issue !== "object" || !("path" in issue) || !Array.isArray(issue.path)) return [];
    return issue.path.filter((part: unknown): part is string => typeof part === "string" && allowed.includes(part));
  }))];
}
