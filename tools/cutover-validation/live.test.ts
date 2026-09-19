import { test } from "node:test";
import assert from "node:assert/strict";
import { gatewayThrottleRecoveryMs, providerRequest, providerInvokedBetween, runPacedGatewayNegativeChecks, simpleTurnErrorCategory, successfulTurn, successfulTurnCheckLabels, successfulTurnChecks, waitForGatewayThrottleRecovery } from "./live.js";
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
test("simple turn classifier reports every successful-turn contract condition", () => {
  const valid = () => ({ events: [{ type: "progress" }, { type: "final", response: "synthetic answer" }],
    measurement: { headersMs: 1, ttfbMs: 1, completionMs: 2 } });
  assert.deepEqual(successfulTurnChecks(valid()), {
    streamErrorAbsent: true, progressObserved: true, singleFinal: true, finalNonEmpty: true,
    internalMarkupAbsent: true, headersObserved: true, ttfbMeasured: true, completionMeasured: true,
  });
  assert.deepEqual(Object.values(successfulTurnCheckLabels), [
    "simple turn / stream error absent", "simple turn / progress observed", "simple turn / single final",
    "simple turn / final non-empty", "simple turn / internal markup absent", "simple turn / TTFB measured",
    "simple turn / completion measured", "simple turn / headers observed",
  ]);
  const cases: Array<[string, (result: any) => void, keyof ReturnType<typeof successfulTurnChecks>]> = [
    ["stream error", result => { result.error = "SYNTHETIC_PRIVATE_ERROR"; }, "streamErrorAbsent"],
    ["missing progress", result => { result.events = result.events.slice(1); }, "progressObserved"],
    ["zero final", result => { result.events = result.events.slice(0, 1); }, "singleFinal"],
    ["two finals", result => { result.events.push({ type: "final", response: "synthetic other" }); }, "singleFinal"],
    ["empty final", result => { result.events[1].response = " "; }, "finalNonEmpty"],
    ["internal markup", result => { result.events[1].response = "<decision_summary>synthetic private</decision_summary>"; }, "internalMarkupAbsent"],
    ["missing TTFB", result => { result.measurement.ttfbMs = undefined; }, "ttfbMeasured"],
    ["missing completion", result => { result.measurement.completionMs = undefined; }, "completionMeasured"],
  ];
  for (const [, mutate, check] of cases) {
    const result = valid();
    mutate(result);
    assert.equal(successfulTurnChecks(result)[check], false);
    assert.throws(() => successfulTurn(result), /validation failed/u);
  }
  assert.equal(successfulTurnChecks({ ...valid(), events: [{ type: "progress" }] }).finalNonEmpty, undefined);
  for (const [error, category] of [[undefined, "no_error"], ["http_401", "http_401"], ["http_503", "http_5xx"], ["http_418", "other_http"], ["invalid_content_type", "invalid_content_type"], ["SYNTHETIC_SECRET", "other"]] as const) assert.equal(simpleTurnErrorCategory(error), category);
});
test("live Provider request reuses strict production contract and derives future dates", () => {
  const a = providerRequest(new Date("2030-12-01T12:00:00Z"));
  assert.equal(a.request.checkInDate, "2031-01-15"); assert.equal(a.request.checkOutDate, "2031-01-16");
  assert.equal(a.request.adults, 1); assert.equal(a.request.limit, 2);
  assert.match(a.requestId!, /^cutover-/u);
});
test("negative Gateway checks leave one throttle interval before the authenticated turn", async () => {
  const waits: number[] = [];
  await waitForGatewayThrottleRecovery(async milliseconds => { waits.push(milliseconds); });
  assert.deepEqual(waits, [gatewayThrottleRecoveryMs]);
  assert.ok(gatewayThrottleRecoveryMs >= 1_000);
});
test("negative Gateway checks pace every request and retain the final recovery interval", async () => {
  const events: string[] = [];
  const harness = { rejected: async (token?: string, origin?: string) => {
    events.push(token === undefined ? origin === undefined ? "unauthenticated canonical" : "unauthenticated direct" :
      origin === undefined ? "invalid-token canonical" : "invalid-token direct");
  } };
  await runPacedGatewayNegativeChecks(harness, "https://direct.example", async (label, action) => {
    events.push(`check ${label}`);
    await action();
  }, async milliseconds => { assert.equal(milliseconds, gatewayThrottleRecoveryMs); events.push("wait"); });
  assert.deepEqual(events, [
    "check unauthenticated rejection", "unauthenticated canonical", "wait", "unauthenticated direct", "wait",
    "check invalid token rejection", "invalid-token canonical", "wait", "invalid-token direct", "wait",
  ]);
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
