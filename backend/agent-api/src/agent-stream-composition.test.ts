import { createTrip } from "@raiquora/trip/trip";
import { serverAgentDeadline } from "./composition/server-agent-deadline.js";
import { afterEach, expect, it, vi } from "vitest";
import { createProductionAgentStream } from "./agent-stream-composition.js";
import { createProductionConversationAgent } from "./composition/production-conversation-agent.js";
import { stateDynamoFixture, conversationId, secondId, stateMetadata } from "./adapters/state-dynamodb.fixture.js";
import { tripDynamoFixture } from "./adapters/trip-dynamodb.fixture.js";
import { cognitoTokenFixture, issuer, token } from "./adapters/cognito-token.fixture.js";
import type { StreamWriter } from "./ports/agent-stream-transport.js";
import { StrandsAgentEngine, type StrandsAgentFactory } from "./adapters/strands-agent-engine.js";
import { createStrandsServerRuntime } from "./adapters/strands-server-runtime.js";
import type { ServerAgentRuntimeRunner } from "./ports/server-agent-runtime.js";
import { strandsScriptedRuntime } from "./adapters/strands-scripted-model.fixture.js";
import { ConversationTurnExecutionError } from "./usecases/agent/conversation-turn.js";
import type { ConversationTurnInput } from "./usecases/agent/conversation-turn.js";
import type { AgentProgressReporter } from "@raiquora/agent/agent-progress";
import type { PublicSemanticReceipt } from "@raiquora/agent/public-semantic-receipt";

function setup(enabled = true, maxExecutionMs?: number, overrideRuntime?: ServerAgentRuntimeRunner) {
  const { verifier } = cognitoTokenFixture();
  const verify = vi.spyOn(verifier, "verify");
  const { model, runRuntime } = strandsScriptedRuntime([
    { name: "strands_structured_output", input: { reply: { kind: "clarification", target: "start_date", text: "確認したい日程を教えてください。" } } },
  ]);
  vi.spyOn(model, "stream");
  const state = stateDynamoFixture(), trips = tripDynamoFixture();
  const createApplication = vi.fn((executionId: string) => createProductionConversationAgent({
    stateTable: "test-state", stateClient: state.client, tripTable: "test-trips", tripClient: trips.client,
    limits: maxExecutionMs === undefined ? undefined : { maxExecutionMs },
    runRuntime: overrideRuntime ?? runRuntime, weather: { search: vi.fn() }, newExecutionId: () => executionId,
  }));
  const log = vi.fn();
  const handle = createProductionAgentStream({ enabled, path: "/api/agent-stream", verifier, createApplication,
    log, newExecutionId: () => "execution-1" });
  const controller = new AbortController();
  const frames: string[] = [];
  const writer: StreamWriter = { signal: controller.signal, start: vi.fn(),
    write: vi.fn(async frame => { frames.push(frame); }), end: vi.fn(async () => {}) };
  const request = { method: "POST", path: "/api/agent-stream", apiRequestId: "gateway-1", lambdaRequestId: "lambda-1",
    headers: { authorization: `Bearer ${token()}`, "content-type": "application/json" },
    body: JSON.stringify({ userRequest: "PRIVATE_MESSAGE", conversationId, turnId: secondId }) };
  const seed = async () => {
    const principal = await verifier.verify(token());
    trips.seed(createTrip(secondId, "検討中の旅", "2026-09-18T00:00:00Z"), principal.subject);
    await state.conversations.create(principal, conversationId, stateMetadata());
    state.commands.length = 0; verify.mockClear();
  };
  return { seed, handle, request, writer, frames, log, model, createApplication, verify, controller, state, trips, verifier };
}
afterEach(() => vi.useRealTimers());
it("rejects disabled composition before authentication, Application construction or model execution", async () => {
  const s = setup(false); await s.handle(s.request, s.writer);
  expect(s.writer.start).toHaveBeenCalledWith(503, expect.anything());
  expect(s.verify).not.toHaveBeenCalled(); expect(s.createApplication).not.toHaveBeenCalled();
});
it.each([
  ["expired", { exp: 1 }, 401], ["issuer", { iss: issuer + "wrong" }, 401],
  ["client", { client_id: "wrong" }, 401], ["ID token", { token_use: "id", aud: "app-client" }, 401],
  ["scope", { scope: "other" }, 403],
])("rejects %s before production Application construction", async (_label, claims, status) => {
  const s = setup(); s.request.headers.authorization = `Bearer ${token(claims as Record<string, unknown>)}`;
  await s.handle(s.request, s.writer);
  expect(s.writer.start).toHaveBeenCalledWith(status, expect.anything());
  expect(s.createApplication).not.toHaveBeenCalled(); expect(s.model.stream).not.toHaveBeenCalled();
  expect(s.state.commands).toHaveLength(0);
});
it("requires Bearer even for direct Gateway events and rejects legacy/PoC routes", async () => {
  for (const change of [{ headers: {} }, { path: "/api/agent" }, { path: "/api/agent-stream-poc" },
    { query: { access_token: "secret" } }, { body: '{"userRequest":"x","principal":{"subject":"forged"}}' }]) {
    const s = setup(); await s.handle({ ...s.request, ...change }, s.writer);
    expect(s.createApplication).not.toHaveBeenCalled(); expect(s.writer.start).not.toHaveBeenCalledWith(200, expect.anything());
  }
});
it("runs the real Server Agent once, with correlated safe logs and no request/state/response content", async () => {
  const s = setup(); await s.seed(); await s.handle(s.request, s.writer);
  expect(s.createApplication).toHaveBeenCalledExactlyOnceWith("execution-1");
  expect(s.model.stream).toHaveBeenCalledOnce();
  expect(s.frames.join("")).toContain('"type":"final"'); expect(s.frames.at(-1)).toContain("event: done");
  expect(s.frames.join("")).toContain('"phase":"understanding_request"');
  expect(s.log.mock.calls.map(([entry]) => entry.event)).toEqual(["request_started", "stream_started", "final_sent", "completed"]);
  for (const [entry] of s.log.mock.calls) {
    expect(entry).toMatchObject({ requestId: "execution-1", apiRequestId: "gateway-1", lambdaRequestId: "lambda-1", latencyMs: expect.any(Number) });
  }
  expect(s.log.mock.calls.at(-1)?.[0].executionId).toBe("execution-1");
  expect(JSON.stringify(s.log.mock.calls)).not.toMatch(/PRIVATE|Bearer|確認|identity-v1|profile|toolUse/i);
});
it("streams Application acceptance after commit without terminating the answer stream", async () => {
  const s = setup();
  const receipt = { version: "public-semantic-receipt-v1" as const, intentRevision: 1, speechAct: "inform" as const, outcome: "accepted" as const,
    changes: [{ changeRef: "change-1", groupRef: "group-1", action: "set" as const, target: "destination" as const,
      scope: { type: "conversation" as const }, frame: "actual" as const, status: "accepted" as const }] };
  s.createApplication.mockImplementation(() => ({ runConversationTurn: async (_input: ConversationTurnInput, _progress?: AgentProgressReporter,
    accepted?: (receipt: PublicSemanticReceipt) => Promise<void>) => {
    await accepted?.(receipt);
    return { status: "completed" as const, response: "回答", semanticReceipt: receipt };
  } }));
  await s.handle(s.request, s.writer);
  const payload = s.frames.join("");
  expect(payload.indexOf('"type":"intent_accepted"')).toBeLessThan(payload.indexOf('"type":"final"'));
  expect(payload.match(/public-semantic-receipt-v1/g)).toHaveLength(2);
  expect(s.frames.at(-1)).toContain("event: done");
});
it("validates the Browser calendar date before composing the runtime", async () => {
  const s = setup(); await s.seed();
  s.request.body = JSON.stringify({ userRequest: "明日から", conversationId, turnId: secondId,
    uiContext: { calendarDate: "2026-09-21" } });
  await s.handle(s.request, s.writer);
  const messages = s.model.observedMessages[0];
  expect(JSON.stringify(messages)).toContain("明日から");

  for (const calendarDate of ["2026-02-30", "2026-99-99"]) {
    const invalid = setup(); invalid.request.body = JSON.stringify({ userRequest: "明日から", conversationId, turnId: secondId,
      uiContext: { calendarDate } });
    await invalid.handle(invalid.request, invalid.writer);
    expect(invalid.writer.start).toHaveBeenCalledWith(400, expect.anything());
    expect(invalid.createApplication).not.toHaveBeenCalled();
  }
});
it("keeps 10 second heartbeats during Application work and records errors without their cause", async () => {
  vi.useFakeTimers(); const s = setup();
  s.createApplication.mockImplementation(() => ({ runConversationTurn: async () => {
    await new Promise(resolve => setTimeout(resolve, 35_000)); throw new Error("PRIVATE_PROVIDER_RESULT");
  } }));
  const pending = s.handle(s.request, s.writer); await vi.advanceTimersByTimeAsync(35_001); await pending;
  expect(s.frames.filter(frame => frame === ": heartbeat\n\n")).toHaveLength(3);
  expect(s.frames.join("")).toContain('"type":"error"');
  expect(s.log.mock.calls.at(-1)?.[0].event).toBe("error");
  expect(JSON.stringify(s.log.mock.calls) + s.frames.join("")).not.toContain("PRIVATE_PROVIDER_RESULT");
});
it("preserves the public runtime-limit code instead of collapsing it into agent_failed", async () => {
  const s = setup();
  s.createApplication.mockImplementation(() => ({ runConversationTurn: async () => {
    throw new ConversationTurnExecutionError("limit_reached");
  } }));
  await s.handle(s.request, s.writer);
  expect(s.frames.join("")).toContain('"type":"error","code":"limit_reached"');
  expect(s.frames.at(-1)).toContain("event: done");
});
it("never reports completion after a failed final write", async () => {
  const s = setup(); await s.seed();
  s.writer.write = vi.fn(async frame => { if (frame.includes('"type":"final"')) throw new Error("PRIVATE_WRITE"); });
  await s.handle(s.request, s.writer);
  expect(s.log.mock.calls.at(-1)?.[0].event).toBe("disconnected");
  expect(s.log.mock.calls.map(([entry]) => entry.event)).not.toContain("final_sent");
});

it("persists final before write and replays without a second model run; altered input conflicts", async () => {
  const s = setup(); await s.seed(); const principal = await s.verifier.verify(token());
  const write = s.writer.write;
  s.writer.write = async frame => {
    if (frame.includes('"type":"final"')) {
      const history = await s.state.conversations.history(principal, conversationId);
      expect(history.items.map(m => m.role)).toEqual(["user", "assistant"]);
    }
    await write(frame);
  };
  await s.handle(s.request, s.writer); await s.handle(s.request, s.writer);
  expect(s.model.stream).toHaveBeenCalledTimes(1);
  await s.handle({ ...s.request, body: JSON.stringify({ conversationId, turnId: secondId, userRequest: "different" }) }, s.writer);
  expect(s.frames.join("")).toContain('"code":"turn_conflict"');
  expect(s.model.stream).toHaveBeenCalledTimes(1);
});
it.each(["history", "profile", "trip", "tools", "toolResults", "messages", "principal"])("rejects %s instead of accepting Browser state", async key => {
  const s = setup(); await s.handle({ ...s.request, body: JSON.stringify({ ...JSON.parse(s.request.body), [key]: "private" }) }, s.writer);
  expect(s.writer.start).toHaveBeenCalledWith(400, expect.anything());
  expect(s.state.commands).toHaveLength(0); expect(s.createApplication).not.toHaveBeenCalled();
});
it("requires both stable UUID references before state access", async () => {
  for (const body of [{ userRequest: "x" }, { conversationId, turnId: "bad", userRequest: "x" }]) {
    const s = setup(); await s.handle({ ...s.request, body: JSON.stringify(body) }, s.writer);
    expect(s.writer.start).toHaveBeenCalledWith(400, expect.anything()); expect(s.state.commands).toHaveLength(0);
  }
});

it("ends a bounded business timeout with limit_reached and no saved final, before the transport timeout", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => {
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  });
  const invoke = vi.fn(async (_args: string, options?: { cancelSignal?: AbortSignal }) => {
    await new Promise<void>(resolve => options?.cancelSignal?.addEventListener("abort", () => resolve(), { once: true }));
    return { stopReason: "cancelled" };
  });
  const createAgent: StrandsAgentFactory = () => ({ invoke });
  const runtime = createStrandsServerRuntime(new StrandsAgentEngine({ modelId: "synthetic", region: "test", systemPrompt: "test" }, { createAgent }));
  const s = setup(true, serverAgentDeadline({ SERVER_AGENT_MAX_EXECUTION_MS: "120000" }), runtime); await s.seed();
  const pending = s.handle(s.request, s.writer);
  await vi.advanceTimersByTimeAsync(119_999);
  expect(s.frames.join("")).not.toContain('"type":"error"');
  await vi.advanceTimersByTimeAsync(2);
  await pending;
  expect(s.frames.join("")).toContain('"code":"limit_reached"');
  expect(s.frames.join("")).not.toContain('"type":"final"');
  expect(s.frames.at(-1)).toContain("event: done");
  expect(invoke).toHaveBeenCalledOnce();
  expect(timeout).toHaveBeenCalledWith(120_000);
  timeout.mockRestore();
  expect([...s.state.records.values()].some(row => row.sk.S?.startsWith("TRIP_TURN#") && row.payload.S?.includes('"completed"'))).toBe(false);
});
