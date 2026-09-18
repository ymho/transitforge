import { afterEach, expect, it, vi } from "vitest";
import { createProductionAgentStream } from "./agent-stream-composition.js";
import { createServerAgent } from "./server-agent-composition.js";
import { cognitoTokenFixture, issuer, token } from "./adapters/cognito-token.fixture.js";
import type { StreamWriter } from "./ports/agent-stream-transport.js";

function setup(enabled = true) {
  const { verifier } = cognitoTokenFixture();
  const verify = vi.spyOn(verifier, "verify");
  const model = { converse: vi.fn(async () => ({ stopReason: "end_turn" as const, metadata: { modelId: "fake", latencyMs: 0 },
    message: { role: "assistant" as const, content: [{ text: "確認したい日程を教えてください。" }] } })) };
  const createApplication = vi.fn((executionId: string) => createServerAgent({
    model, weather: { search: vi.fn() }, newExecutionId: () => executionId,
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
    body: JSON.stringify({ userRequest: "PRIVATE_MESSAGE", conversationId: "PRIVATE_CONVERSATION", tripId: "PRIVATE_TRIP" }) };
  return { handle, request, writer, frames, log, model, createApplication, verify, controller };
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
  expect(s.createApplication).not.toHaveBeenCalled(); expect(s.model.converse).not.toHaveBeenCalled();
});
it("requires Bearer even for direct Gateway events and rejects legacy/PoC routes", async () => {
  for (const change of [{ headers: {} }, { path: "/api/agent" }, { path: "/api/agent-stream-poc" },
    { query: { access_token: "secret" } }, { body: '{"userRequest":"x","principal":{"subject":"forged"}}' }]) {
    const s = setup(); await s.handle({ ...s.request, ...change }, s.writer);
    expect(s.createApplication).not.toHaveBeenCalled(); expect(s.writer.start).not.toHaveBeenCalledWith(200, expect.anything());
  }
});
it("runs the real Server Agent once, with correlated safe logs and no request/state/response content", async () => {
  const s = setup(); await s.handle(s.request, s.writer);
  expect(s.createApplication).toHaveBeenCalledExactlyOnceWith("execution-1");
  expect(s.model.converse).toHaveBeenCalledOnce();
  expect(s.frames.join("")).toContain('"type":"final"'); expect(s.frames.at(-1)).toContain("event: done");
  expect(s.log.mock.calls.map(([entry]) => entry.event)).toEqual(["request_started", "stream_started", "final_sent", "completed"]);
  for (const [entry] of s.log.mock.calls) {
    expect(entry).toMatchObject({ requestId: "execution-1", apiRequestId: "gateway-1", lambdaRequestId: "lambda-1", latencyMs: expect.any(Number) });
  }
  expect(s.log.mock.calls.at(-1)?.[0].executionId).toBe("execution-1");
  expect(JSON.stringify(s.log.mock.calls)).not.toMatch(/PRIVATE|Bearer|確認|identity-v1|profile|toolUse/i);
});
it("keeps 10 second heartbeats during Application work and records errors without their cause", async () => {
  vi.useFakeTimers(); const s = setup();
  s.createApplication.mockImplementation(() => ({ runAgentTurn: async () => {
    await new Promise(resolve => setTimeout(resolve, 35_000)); throw new Error("PRIVATE_PROVIDER_RESULT");
  } }));
  const pending = s.handle(s.request, s.writer); await vi.advanceTimersByTimeAsync(35_001); await pending;
  expect(s.frames.filter(frame => frame === ": heartbeat\n\n")).toHaveLength(3);
  expect(s.frames.join("")).toContain('"type":"error"');
  expect(s.log.mock.calls.at(-1)?.[0].event).toBe("error");
  expect(JSON.stringify(s.log.mock.calls) + s.frames.join("")).not.toContain("PRIVATE_PROVIDER_RESULT");
});
it("never reports completion after a failed final write", async () => {
  const s = setup();
  s.writer.write = vi.fn(async frame => { if (frame.includes('"type":"final"')) throw new Error("PRIVATE_WRITE"); });
  await s.handle(s.request, s.writer);
  expect(s.log.mock.calls.at(-1)?.[0].event).toBe("disconnected");
  expect(s.log.mock.calls.map(([entry]) => entry.event)).not.toContain("final_sent");
});
