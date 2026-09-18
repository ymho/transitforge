import { test } from "node:test";
import assert from "node:assert/strict";
import { providerRequest, providerInvokedBetween, successfulTurn } from "./live.js";
import { consumeAgentStream } from "../../frontend/src/adapters/http/agent-stream/consumer.js";

const frame = (seq: number, event: object) => `event: agent\ndata: ${JSON.stringify({ v: 1, runId: "synthetic", seq, event })}\n\n`;
const progress = frame(1, { type: "progress", phase: "running" });
const final = frame(2, { type: "final", status: "completed", response: "synthetic answer" });
const done = 'event: done\ndata: {"v":1,"runId":"synthetic","seq":3}\n\n';
async function consume(text: string, byteChunks = false) {
  const events: object[] = [], measurement = { requestStart: 0, maxSilenceMs: 0 };
  await consumeAgentStream({ token: "synthetic", request: { userRequest: "synthetic" }, endpoint: "/api/agent-stream",
    signal: new AbortController().signal, isCurrent: () => true, onEvent: event => events.push(event), measurement,
    fetcher: async () => new Response(new ReadableStream({ start(controller) {
      const bytes = new TextEncoder().encode(text);
      if (byteChunks) for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      else controller.enqueue(bytes);
      controller.close();
    } }), { headers: { "content-type": "text/event-stream" } }) });
  return { events, measurement };
}
test("production parser consumes split UTF-8, progress/final/done/EOF and rejects leaked fields", async () => {
  const result = await consume(progress + final + done, true);
  assert.equal(successfulTurn(result), "synthetic answer");
  for (const text of [progress + final, progress + done, progress + final + done + "partial",
    progress + frame(2, { type: "final", status: "completed", response: "synthetic", trace: "PRIVATE" }) + done,
    progress + frame(3, { type: "final", status: "completed", response: "synthetic" }) + done]) {
    await assert.rejects(consume(text));
  }
  await assert.rejects(consume(progress + frame(2, { type: "error", code: "turn_conflict" }) + done), /turn_conflict/u);
  const leaked = await consume(progress + frame(2, { type: "final", status: "completed", response: '<decision_summary>synthetic internal trace</decision_summary>' }) + done);
  assert.throws(() => successfulTurn(leaked), /validation failed/u);
});
test("live Provider request reuses strict production contract and derives future dates", () => {
  const a = providerRequest(new Date("2030-12-01T12:00:00Z"));
  assert.equal(a.request.checkInDate, "2031-01-15"); assert.equal(a.request.checkOutDate, "2031-01-16");
  assert.equal(a.request.adults, 1); assert.equal(a.request.limit, 2);
  assert.match(a.requestId!, /^cutover-/u);
});
test("Provider invocation corroboration uses bounded time window and ignores arbitrary log messages", async () => {
  let input: any;
  await providerInvokedBetween(async (_service: string, _operation: string, request: any) => {
    input = request;
    return { events: [{ message: "START RequestId: 11111111-1111-4111-8111-111111111111 Version: $LATEST\n" }] };
  }, "synthetic-provider", 100, 200);
  assert.equal(input.startTime, 100); assert.equal(input.endTime, 200);
  assert.equal(input.filterPattern, '"START RequestId:"');
});
