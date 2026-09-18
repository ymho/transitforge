import { afterEach, expect, it, vi } from "vitest";
import { createAgentStreamHandler, type StreamWriter } from "./handler.js";
import { cognitoTokenFixture, token, issuer } from "../adapters/cognito-token.fixture.js";
import { syntheticAgentRun } from "./synthetic.js";
import { fakeServerAgentRun } from "./fake-server-agent.js";

function sink() {
  const controller = new AbortController(), chunks: string[] = [];
  const writer: StreamWriter = { signal: controller.signal, start: vi.fn(), write: async frame => { chunks.push(frame); }, end: vi.fn(async () => {}) };
  return { writer, chunks, controller };
}
const request = () => ({ method: "POST", path: "/api/agent-stream-poc", headers: { authorization: `Bearer ${token()}`, "content-type": "application/json" }, body: '{"userRequest":"天気を確認"}' });
afterEach(() => vi.useRealTimers());
it.each([["expired", { exp: 1 }, 401], ["issuer", { iss: issuer + "wrong" }, 401], ["client", { client_id: "wrong" }, 401],
  ["ID Token", { token_use: "id", aud: "app-client" }, 401], ["scope", { scope: "other" }, 403]])("rejects %s before running Agent/model/tools", async (_label, changes, status) => {
  const { verifier } = cognitoTokenFixture(), run = vi.fn(), { writer, chunks } = sink();
  await createAgentStreamHandler({ verifier, run, newRunId: () => "run" })({ ...request(), headers: { authorization: `Bearer ${token(changes as Record<string, unknown>)}` } }, writer);
  expect(writer.start).toHaveBeenCalledWith(status, expect.anything()); expect(run).not.toHaveBeenCalled();
  expect(chunks.join("")).not.toContain("Bearer");
});
it("connects valid Cognito fixture to one Server Agent run and real weather Usecase, projecting no Trace/payload", async () => {
  const { verifier } = cognitoTokenFixture(), counts = { model: 0, tool: 0 }, { writer, chunks } = sink();
  await createAgentStreamHandler({ verifier, run: fakeServerAgentRun(counts), newRunId: () => "run" })(request(), writer);
  expect(counts).toEqual({ model: 2, tool: 1 });
  expect(chunks.join("")).toContain('"type":"final"'); expect(chunks.at(-1)).toContain("event: done");
  expect(chunks.join("")).not.toMatch(/toolUse|decision_summary|identity-v1|retrievedAt|latitude|trace|Bearer/);
});
it.each([35_000, 90_000, 180_000])("maintains heartbeats for %s ms on virtual time", async duration => {
  vi.useFakeTimers(); const { verifier } = cognitoTokenFixture(), { writer, chunks } = sink();
  const scenario = duration === 35_000 ? "over30" : duration === 90_000 ? "ninety" : "minutes";
  const running = createAgentStreamHandler({ verifier, run: syntheticAgentRun(scenario), newRunId: () => "run" })(request(), writer);
  await vi.advanceTimersByTimeAsync(duration + 1); await running;
  expect(chunks.filter(c => c.startsWith(":"))).toHaveLength(Math.floor(duration / 10_000));
  expect(chunks.at(-1)).toContain("done");
});
it("redacts mid-stream failures and does not confuse missing final with success", async () => {
  vi.useFakeTimers(); const { verifier } = cognitoTokenFixture();
  for (const scenario of ["mid_error", "missing_final"] as const) {
    const { writer, chunks } = sink(); const running = createAgentStreamHandler({ verifier, run: syntheticAgentRun(scenario), newRunId: () => "run" })(request(), writer);
    await vi.advanceTimersByTimeAsync(1001); await running;
    expect(chunks.join("")).toContain('"code":"agent_failed"'); expect(chunks.join("")).not.toContain("PRIVATE");
  }
});
it("stops writes after disconnect even if the underlying synthetic work continues", async () => {
  vi.useFakeTimers(); const { verifier } = cognitoTokenFixture(), { writer, chunks, controller } = sink();
  const running = createAgentStreamHandler({ verifier, run: syntheticAgentRun("ninety"), newRunId: () => "run" })(request(), writer);
  await vi.advanceTimersByTimeAsync(20_001); controller.abort(); const count = chunks.length;
  await vi.advanceTimersByTimeAsync(70_000); await running; expect(chunks).toHaveLength(count);
});
it("rejects body principal, duplicate Authorization, and query parameters", async () => {
  const { verifier } = cognitoTokenFixture(), run = vi.fn();
  for (const change of [{ body: '{"userRequest":"hello","principal":{"subject":"forged"}}' },
    { multiValueHeaders: { Authorization: [token(), token()] } }, { query: { access_token: "no" } }]) {
    const { writer } = sink(); await createAgentStreamHandler({ verifier, run, newRunId: () => "run" })({ ...request(), ...change }, writer);
    expect(writer.start).toHaveBeenCalledWith(400, expect.anything());
  }
  expect(run).not.toHaveBeenCalled();
});
